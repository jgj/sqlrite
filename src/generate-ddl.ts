import type {
  Column,
  Index,
  IntrospectionResult,
  Table,
  Trigger,
  View,
  VirtualTable,
} from "./introspection-result";
import {
  type VirtualTableOperation,
  type VirtualTableRecreateOperation,
  getTableRenameMap,
  isVirtualTableOperation,
} from "./migration-operation";
import type { MigrationPlan } from "./migration-plan";
import {
  columnsLookLikeRename,
  ensureSemicolon,
  findViewsDependingOnTable,
  invariant,
  isTesting,
  foldName as lower,
  sqlIdentifier as sql,
} from "./utils";
import { replaceCreateTableName } from "./virtual-tables/parse";
import { getRecreateModule, resolveVirtualTable, sameModule } from "./virtual-tables/registry";

export type DDLStatement = string;

// Views and triggers that the recreate of a table or virtual table drops, and
// the view drops the plan emits, have to be put back from the desired schema.
//
// SQLite does not check a view or trigger body when it is created, but every
// ALTER TABLE (RENAME, RENAME COLUMN, DROP COLUMN) checks the whole schema and
// fails when a view or trigger refers to a table, view or column that does not
// exist at that moment. So:
// - views that a virtual table recreate drops are dropped at the start, before
//   any ALTER TABLE, rather than when the (late) recreate runs
// - views that read a dropped view are dropped at the start too, and put back
//   from the desired schema
// - the views and triggers a recreate puts back are only created once every
//   ALTER TABLE has run (before the first rebuild, which may read the views,
//   or at the end), as they may refer to tables and virtual tables that later
//   operations create or rename
//
// SQLite drops the triggers on a view (INSTEAD OF triggers) together with the
// view, and CREATE TRIGGER ... ON a view fails while the view does not exist.
// So the desired triggers on a view are created right after the view itself,
// whichever way the view is (re)created.
type ViewAndTriggerState = {
  /** Lowercase names of the views dropped so far */
  dropped: Set<string>;
  /** Lowercase names of the views created so far */
  created: Set<string>;
  /** Statements that put views and triggers back, by viewKey/triggerKey */
  deferred: Map<string, DDLStatement>;
  /** Lowercase names of the triggers created so far */
  triggers: Set<string>;
  /** Desired triggers by the lowercase name of the view they are on */
  viewTriggers: Map<string, Trigger[]>;
};

const viewKey = (name: string) => `view:${lower(name)}`;
const triggerKey = (name: string) => `trigger:${lower(name)}`;

// Put a view back once every ALTER TABLE has run, along with its triggers
function deferView(state: ViewAndTriggerState, view: View): void {
  state.deferred.set(viewKey(view.name), generateCreateViewDDL(view));
  for (const trigger of state.viewTriggers.get(lower(view.name)) ?? []) {
    state.deferred.set(triggerKey(trigger.name), generateCreateTriggerDDL(trigger));
  }
}

// Create a view now, followed by its triggers
function createView(state: ViewAndTriggerState, view: View): DDLStatement[] {
  state.created.add(lower(view.name));
  const statements = [generateCreateViewDDL(view)];
  for (const trigger of state.viewTriggers.get(lower(view.name)) ?? []) {
    if (state.triggers.has(lower(trigger.name))) continue;
    state.triggers.add(lower(trigger.name));
    statements.push(generateCreateTriggerDDL(trigger));
  }
  return statements;
}

export function generateDDL(
  plan: MigrationPlan,
  curr: IntrospectionResult,
  next: IntrospectionResult,
): DDLStatement[] {
  const statements: DDLStatement[] = [];
  const nextViews = new Set(next.views.map((v) => lower(v.name)));
  const keptViews = getKeptViews(plan, curr, next);
  const keptViewNames = new Set(keptViews.map((v) => lower(v.name)));
  const viewTriggers = new Map<string, Trigger[]>();
  const addViewTrigger = (trigger: Trigger) => {
    const table = lower(trigger.table);
    viewTriggers.set(table, [...(viewTriggers.get(table) ?? []), trigger]);
  };
  for (const trigger of next.triggers) {
    if (nextViews.has(lower(trigger.table))) addViewTrigger(trigger);
  }
  // A kept view is put back as it is, with its triggers
  for (const trigger of curr.triggers) {
    if (keptViewNames.has(lower(trigger.table))) addViewTrigger(trigger);
  }
  const state: ViewAndTriggerState = {
    dropped: new Set(),
    created: new Set(),
    deferred: new Map(),
    triggers: new Set(),
    viewTriggers,
  };
  const currentViews = new Set(curr.views.map((v) => lower(v.name)));
  const viewExists = (name: string) =>
    state.created.has(lower(name)) ||
    (currentViews.has(lower(name)) && !state.dropped.has(lower(name)));
  // Plan trigger creates on a view that does not exist yet
  const waiting: Trigger[] = [];
  const renamedTables = getTableRenameMap(plan);

  // Create column lookup tables for efficiency
  const currentColumnsByTable = groupColumnsByTable(curr.columns);
  const targetColumnsByTable = groupColumnsByTable(next.columns);

  const flushDeferred = () => {
    for (const [key, statement] of state.deferred) {
      const [kind, name = ""] = key.split(/:(.*)/s);
      if (kind === "view") state.created.add(name);
      if (kind === "trigger") state.triggers.add(name);
      statements.push(statement);
    }
    state.deferred.clear();
  };

  // The drop steps of the virtual table recreates split in two that lead the
  // plan read the rows to carry through the current virtual table, possibly
  // from a content view: they run before anything else, the early view drops
  // included (see splitVirtualTableRecreates in migration-plan.ts)
  const leading = plan.findIndex(
    (op) => !(isVirtualTableOperation(op) && op.type === "recreate" && op.step === "drop"),
  );
  const firstSteps = leading === -1 ? plan : plan.slice(0, leading);
  const rest = leading === -1 ? [] : plan.slice(leading);

  // Triggers that refer to a table or virtual table missing for part of the
  // migration are dropped before it goes missing and put back at the end
  const missing = getTriggersReferencingMissingTables(plan, curr, next);
  for (const trigger of missing.drops) {
    statements.push(generateDropTriggerDDL(trigger));
  }
  waiting.push(...missing.restores);

  for (const operation of firstSteps) processOperation(operation);

  const early = getEarlyViewDrops(plan, curr, next, keptViews);
  for (const view of early.drops) {
    if (state.dropped.has(lower(view.name))) continue;
    statements.push(generateDropViewDDL(view));
    state.dropped.add(lower(view.name));
  }
  for (const view of early.restores) {
    deferView(state, view);
  }

  for (const operation of rest) processOperation(operation);

  // Process one operation of the plan
  function processOperation(operation: MigrationPlan[number]): void {
    try {
      if (operation.type === "rebuild") flushDeferred();

      if (isVirtualTableOperation(operation)) {
        statements.push(
          ...generateVirtualTableDDL(operation, curr, next, state, renamedTables, keptViews),
        );
        return;
      }

      switch (operation.type) {
        case "create":
          if (operation.target.type === "table") {
            statements.push(generateCreateTableDDL(operation.target));
          } else if (operation.target.type === "column") {
            statements.push(generateAddColumnDDL(operation.target));
          } else if (operation.target.type === "index") {
            statements.push(generateCreateIndexDDL(operation.target));
          } else if (operation.target.type === "trigger") {
            // A trigger on a view that does not exist at this point is
            // created together with the view (see createView/deferView)
            const onView = nextViews.has(lower(operation.target.table));
            if (onView && !viewExists(operation.target.table)) {
              waiting.push(operation.target);
              break;
            }
            if (state.triggers.has(lower(operation.target.name))) break;
            state.triggers.add(lower(operation.target.name));
            statements.push(generateCreateTriggerDDL(operation.target));
          } else if (operation.target.type === "view") {
            statements.push(...createView(state, operation.target));
          }
          break;

        case "drop":
          if (operation.current.type === "table") {
            statements.push(generateDropTableDDL(operation.current));
          } else if (operation.current.type === "column") {
            statements.push(generateDropColumnDDL(operation.current));
          } else if (operation.current.type === "index") {
            statements.push(generateDropIndexDDL(operation.current));
          } else if (operation.current.type === "trigger") {
            statements.push(generateDropTriggerDDL(operation.current));
          } else if (operation.current.type === "view") {
            if (!state.dropped.has(lower(operation.current.name))) {
              statements.push(generateDropViewDDL(operation.current));
              state.dropped.add(lower(operation.current.name));
            }
          }
          break;

        case "rename":
          if (operation.current.type === "table" && operation.target.type === "table") {
            statements.push(generateRenameTableDDL(operation.current, operation.target));
          } else if (operation.current.type === "column" && operation.target.type === "column") {
            statements.push(generateRenameColumnDDL(operation.current, operation.target));
          }
          break;

        case "recreate":
          if (operation.current.type === "table" && operation.target.type === "table") {
            const tableName = operation.target.name;
            // Get dependent objects that should exist on the target table
            const targetIndexes = next.indices.filter(
              (idx) => idx.table === tableName && !idx.name.startsWith("sqlite_autoindex"),
            );
            const targetTriggers = next.triggers.filter((t) => t.table === tableName);
            // The desired views over the table, and the kept ones as they are
            const targetViews = recreateViews(operation, curr, next, keptViews).creates;
            statements.push(
              ...generateRecreateTableDDL(
                operation.current,
                operation.target,
                currentColumnsByTable[operation.current.name] || [],
                targetColumnsByTable[operation.target.name] || [],
                targetIndexes,
                targetTriggers,
                targetViews,
                state,
              ),
            );
          }
          break;
      }
    } catch (error) {
      !isTesting() && console.error("Error generating DDL for operation:", operation, error);
      // Add the error as a comment in the SQL output for debugging
      statements.push(`-- Error generating DDL: ${error}`);
    }
  }

  flushDeferred();
  // Triggers put back once every table exists again (see
  // getTriggersReferencingMissingTables), and triggers left waiting for a
  // view that nothing created (not expected)
  for (const trigger of waiting) {
    if (state.triggers.has(lower(trigger.name))) continue;
    state.triggers.add(lower(trigger.name));
    statements.push(generateCreateTriggerDDL(trigger));
  }
  return statements;
}

/**
 * Triggers that refer to a table or virtual table the plan drops and creates
 * again further on: a virtual table recreate split in two steps, or a table
 * replaced by a virtual table of the same name (or the reverse). Every ALTER
 * TABLE run in between checks the whole schema and fails on a trigger that
 * refers to a missing table (e.g. an FTS sync trigger on another table that
 * writes to the index), so such triggers are dropped at the start and their
 * desired versions put back at the end. The triggers the plan drops itself,
 * and those on the missing table (dropped along with it), are left to the plan.
 */
function getTriggersReferencingMissingTables(
  plan: MigrationPlan,
  curr: IntrospectionResult,
  next: IntrospectionResult,
): { drops: Trigger[]; restores: Trigger[] } {
  const dropped = new Set<string>();
  const missing = new Set<string>();
  const droppedTriggers = new Set<string>();
  for (const op of plan) {
    const splitRecreate =
      isVirtualTableOperation(op) && op.type === "recreate" ? op.step : undefined;
    if (op.type === "drop" && op.current.type === "trigger") {
      droppedTriggers.add(lower(op.current.name));
    }
    if (
      (op.type === "drop" &&
        (op.current.type === "table" || op.current.type === "virtual_table")) ||
      splitRecreate === "drop"
    ) {
      dropped.add(lower(op.current?.name ?? ""));
    }
    const created =
      (op.type === "create" &&
        (op.target.type === "table" || op.target.type === "virtual_table")) ||
      splitRecreate === "create";
    if (created && op.target && dropped.has(lower(op.target.name))) {
      missing.add(lower(op.target.name));
    }
  }
  if (missing.size === 0) return { drops: [], restores: [] };

  const drops = curr.triggers.filter(
    (trigger) =>
      !droppedTriggers.has(lower(trigger.name)) &&
      !missing.has(lower(trigger.table)) &&
      [...missing].some((name) => findViewsDependingOnTable({ name }, [trigger]).length > 0),
  );
  const restores = drops.flatMap((trigger) =>
    next.triggers.filter((t) => lower(t.name) === lower(trigger.name)),
  );
  return { drops, restores };
}

/**
 * Views dropped at the very start: the views a virtual table recreate drops,
 * and the views that read a view dropped anywhere in the migration (which
 * would otherwise be left referring to a missing view). `restores` are the
 * desired versions of the views that read a dropped view, which nothing else
 * creates.
 */
function getEarlyViewDrops(
  plan: MigrationPlan,
  curr: IntrospectionResult,
  next: IntrospectionResult,
  keptViews: readonly View[],
): { drops: View[]; restores: View[] } {
  const dropped = new Set<string>();
  const created = new Set<string>();
  const early = new Map<string, View>();
  const currentView = (name: string) => curr.views.find((v) => lower(v.name) === lower(name));

  for (const op of plan) {
    if (op.type === "drop" && op.current.type === "view") dropped.add(lower(op.current.name));
    if (op.type === "create" && op.target.type === "view") created.add(lower(op.target.name));
    if (op.type !== "recreate") continue;

    const views = recreateViews(op, curr, next, keptViews);
    for (const view of views.drops) {
      dropped.add(lower(view.name));
      const existing = currentView(view.name);
      if (isVirtualTableOperation(op) && existing) early.set(lower(view.name), existing);
    }
    for (const view of views.creates) created.add(lower(view.name));
  }

  // Views that read a dropped view, transitively. Only those the desired
  // schema keeps are handled here; the plan drops the others.
  const restores: View[] = [];
  let found = true;
  while (found) {
    found = false;
    for (const view of curr.views) {
      const name = lower(view.name);
      if (dropped.has(name)) continue;
      const desired = next.views.find((v) => lower(v.name) === name);
      if (!desired) continue;
      const readsDropped = curr.views.some(
        (other) =>
          dropped.has(lower(other.name)) && findViewsDependingOnTable(other, [view]).length > 0,
      );
      if (!readsDropped) continue;

      dropped.add(name);
      early.set(name, view);
      if (!created.has(name)) restores.push(desired);
      found = true;
    }
  }

  return { drops: [...early.values()], restores };
}

/**
 * The views a recreate drops (current and desired versions, by name) and the
 * views it puts back: the desired ones, and the kept ones (see getKeptViews)
 * as they are
 */
function recreateViews(
  op: MigrationPlan[number] & { type: "recreate" },
  curr: IntrospectionResult,
  next: IntrospectionResult,
  kept: readonly View[],
): { drops: View[]; creates: View[] } {
  if (op.current.type === "table") {
    const creates = [
      ...next.views.filter((v) => v.tables.includes(op.target.name)),
      ...kept.filter((v) => v.tables.includes(op.current.name)),
    ];
    return { drops: creates, creates };
  }
  const currentViews = curr.views.filter((v) => v.tables.includes(op.current.name));
  const creates = [
    ...next.views.filter((v) => v.tables.includes(op.target.name)),
    ...kept.filter((v) => currentViews.includes(v)),
  ];
  return { drops: [...currentViews, ...creates], creates };
}

/**
 * Views that the desired schema does not declare but that the migration keeps:
 * with ignoreTableDeletion, a view that reads a table or virtual table the
 * desired schema omits is left alone, as that table is. A recreate of a table
 * or virtual table still has to drop such a view when it reads the recreated
 * table too, so it puts the view back as it was.
 */
function getKeptViews(
  plan: MigrationPlan,
  curr: IntrospectionResult,
  next: IntrospectionResult,
): View[] {
  const declared = new Set([...next.tables, ...next.virtual_tables].map((t) => lower(t.name)));
  const changed = new Set<string>();
  for (const op of plan) {
    if (op.type === "create" || op.type === "rebuild") continue;
    const type = op.current.type;
    if (type === "table" || type === "virtual_table" || type === "view") {
      changed.add(`${type === "view" ? "view" : "table"}:${lower(op.current.name)}`);
    }
  }
  const kept = new Set(
    [...curr.tables, ...curr.virtual_tables]
      .map((t) => lower(t.name))
      .filter((name) => !declared.has(name) && !changed.has(`table:${name}`)),
  );
  const nextViews = new Set(next.views.map((v) => lower(v.name)));

  return curr.views.filter(
    (view) =>
      !nextViews.has(lower(view.name)) &&
      !changed.has(`view:${lower(view.name)}`) &&
      view.tables.some((table) => kept.has(lower(table))),
  );
}

function generateVirtualTableDDL(
  operation: VirtualTableOperation,
  curr: IntrospectionResult,
  next: IntrospectionResult,
  state: ViewAndTriggerState,
  renamedTables: ReadonlyMap<string, string>,
  keptViews: readonly View[],
): DDLStatement[] {
  switch (operation.type) {
    case "create":
      return createVirtualTableDDL(operation.target);

    case "drop":
      return dropVirtualTableDDL(operation.current);

    case "rename":
      return [
        `ALTER TABLE ${sql(operation.current.name)} RENAME TO ${sql(operation.target.name)};`,
      ];

    case "recreate": {
      // A view left pointing at a dropped table makes every later ALTER TABLE
      // ... RENAME in the database fail, so dependent views are dropped (at
      // the start of the migration, see getEarlyViewDrops) and recreated from
      // the desired schema afterwards. The plan keeps them out of the regular
      // view drops/creates.
      const views = recreateViews(operation, curr, next, keptViews);
      const dropViews = new Set(
        views.drops.map((v) => v.name).filter((name) => !state.dropped.has(lower(name))),
      );
      for (const name of dropViews) state.dropped.add(lower(name));
      for (const view of views.creates) deferView(state, view);

      return [
        ...[...dropViews].map((name) => `DROP VIEW IF EXISTS ${sql(name)};`),
        ...recreateVirtualTableDDL(operation, next, renamedTables),
      ];
    }

    case "rebuild": {
      const { handler, args } = resolveVirtualTable(operation.target);
      invariant(
        handler.rebuild,
        `Module ${operation.target.module} of virtual table "${operation.target.name}" cannot rebuild`,
      );
      return handler.rebuild({ target: operation.target, args });
    }
  }
}

function createVirtualTableDDL(target: VirtualTable): DDLStatement[] {
  const { handler, args } = resolveVirtualTable(target);
  return handler.create ? handler.create(target, args) : [ensureSemicolon(target.sql)];
}

function dropVirtualTableDDL(current: VirtualTable): DDLStatement[] {
  const { handler, args } = resolveVirtualTable(current);
  return handler.drop
    ? handler.drop(current, args)
    : [`DROP TABLE IF EXISTS ${sql(current.name)};`];
}

// A handler's recreate assumes both sides use its module. When the module
// changes, the current module's handler drops the table (e.g. FTS5's
// workaround for contentless_unindexed) and the new module's handler creates
// it (e.g. FTS5's rebuild of an external-content index). A recreate split in
// two steps (see VirtualTableRecreateOperation.step) emits one of them.
function recreateVirtualTableDDL(
  operation: VirtualTableRecreateOperation,
  next: IntrospectionResult,
  renamedTables: ReadonlyMap<string, string>,
): DDLStatement[] {
  const pick = (steps: { drop: DDLStatement[]; create: DDLStatement[] }) => {
    if (operation.step === "drop") return steps.drop;
    if (operation.step === "create") return steps.create;
    return [...steps.drop, ...steps.create];
  };
  const fallback = () => ({
    drop: dropVirtualTableDDL(operation.current),
    create: createVirtualTableDDL(operation.target),
  });

  if (!sameModule(operation.current, operation.target)) return pick(fallback());
  const handler = getRecreateModule(operation);
  const ctx = {
    current: operation.current,
    target: operation.target,
    currentArgs: handler.parseArgs(operation.current.args),
    targetArgs: handler.parseArgs(operation.target.args),
    desired: next,
    renamedTables,
  };
  if (operation.step === undefined) return handler.recreate(ctx);
  return pick(handler.recreateSteps ? handler.recreateSteps(ctx) : fallback());
}

// Helper to group columns by table for faster lookup
function groupColumnsByTable(columns: Column[]): Record<string, Column[]> {
  return columns.reduce<Record<string, Column[]>>((acc, column) => {
    const group = acc[column.table] ?? [];
    group.push(column);
    acc[column.table] = group;
    return acc;
  }, {});
}

// Generate DDL for dropping a view
function generateDropViewDDL(view: View): DDLStatement {
  return `DROP VIEW IF EXISTS ${sql(view.name)};`;
}

// Generate DDL for creating a view
function generateCreateViewDDL(view: View): DDLStatement {
  return ensureSemicolon(view.sql);
}

// Generate DDL for dropping a trigger
function generateDropTriggerDDL(trigger: Trigger): DDLStatement {
  return `DROP TRIGGER IF EXISTS ${sql(trigger.name)};`;
}

// Generate DDL for creating a trigger
function generateCreateTriggerDDL(trigger: Trigger): DDLStatement {
  return ensureSemicolon(trigger.sql);
}

// Generate DDL for dropping an index
function generateDropIndexDDL(index: Index): DDLStatement {
  return `DROP INDEX IF EXISTS ${sql(index.name)};`;
}

// Generate DDL for creating an index
function generateCreateIndexDDL(index: Index): DDLStatement {
  if (index.sql) {
    return ensureSemicolon(index.sql);
  }
  return generateIndexSQL(index);
}

// Generate index SQL if not available in the index object
function generateIndexSQL(index: Index): string {
  const uniq = index.unique ? "UNIQUE " : "";
  return `CREATE ${uniq}INDEX ${sql(index.name)} ON ${sql(index.table)} (${index.columns.map(sql).join(",")});`;
}

// Generate DDL for dropping a table
function generateDropTableDDL(table: Table): DDLStatement {
  return `DROP TABLE IF EXISTS ${sql(table.name)};`;
}

// Generate DDL for creating a table
function generateCreateTableDDL(table: Table): DDLStatement {
  return ensureSemicolon(table.sql);
}

// Generate DDL for renaming a table
function generateRenameTableDDL(currentTable: Table, targetTable: Table): DDLStatement {
  return `ALTER TABLE ${sql(currentTable.name)} RENAME TO ${sql(targetTable.name)};`;
}

// Generate DDL for adding a column
function generateAddColumnDDL(column: Column): DDLStatement {
  return `ALTER TABLE ${sql(column.table)} ADD COLUMN ${generateColumnDefinition(column)};`;
}

// Generate a column definition string
function generateColumnDefinition(column: Column): string {
  let definition = `${sql(column.name)} ${column.data_type.toUpperCase()}`;

  // Add length constraint if specified
  if (column.character_maximum_length !== null) {
    definition += `(${column.character_maximum_length})`;
  }

  // Add precision/scale if specified
  if (column.precision !== null) {
    definition += `(${column.precision.precision},${column.precision.scale})`;
  }

  // Add NOT NULL constraint if required
  if (!column.nullable) {
    definition += " NOT NULL";
  }

  // Add default value if specified
  if (column.default && column.default.trim() !== "") {
    definition += ` DEFAULT ${column.default}`;
  }

  return definition;
}

// Generate DDL for dropping a column
function generateDropColumnDDL(column: Column): DDLStatement {
  return `ALTER TABLE ${sql(column.table)} DROP COLUMN ${sql(column.name)};`;
}

// Generate DDL for renaming a column
function generateRenameColumnDDL(currentColumn: Column, targetColumn: Column): DDLStatement {
  return `ALTER TABLE ${sql(currentColumn.table)} RENAME COLUMN ${sql(currentColumn.name)} TO ${sql(targetColumn.name)};`;
}

// Generate DDL for table recreation (complex schema changes)
function generateRecreateTableDDL(
  currentTable: Table,
  targetTable: Table,
  currentColumns: Column[],
  targetColumns: Column[],
  targetIndexes: Index[],
  targetTriggers: Trigger[],
  targetViews: View[],
  state: ViewAndTriggerState,
): DDLStatement[] {
  const statements: DDLStatement[] = [];
  const safeName = targetTable.name.replace(/[^a-zA-Z0-9_]/g, "_");
  const tempTableName = `temp_${safeName}`;

  // Drop dependent views and triggers first (they reference the table by name)
  for (const view of targetViews) {
    if (state.dropped.has(lower(view.name))) continue;
    statements.push(generateDropViewDDL(view));
    state.dropped.add(lower(view.name));
  }
  for (const trigger of targetTriggers) {
    statements.push(generateDropTriggerDDL(trigger));
  }

  // Create temporary table with new schema. The name token is replaced
  // whatever its quoting ('x', "x", `x`, [x] or bare).
  const createTempTableSQL = replaceCreateTableName(targetTable.sql, sql(tempTableName));
  statements.push(ensureSemicolon(createTempTableSQL));

  // Build column mapping: target column name -> source column name
  // Handles both common columns (same name) and renamed columns
  const generatedColumns = new Set(
    targetColumns.filter((col) => col.generated !== "none").map((col) => col.name),
  );

  const columnMapping = buildColumnMapping(currentColumns, targetColumns, generatedColumns);

  // Copy data from old table to new table
  if (columnMapping.length > 0) {
    const targetList = columnMapping.map(({ target }) => sql(target)).join(", ");
    const sourceList = columnMapping.map(({ source }) => sql(source)).join(", ");
    statements.push(
      `INSERT INTO ${sql(tempTableName)} (${targetList}) SELECT ${sourceList} FROM ${sql(currentTable.name)};`,
    );
  }

  // Drop old table
  statements.push(`DROP TABLE ${sql(currentTable.name)};`);

  // Rename temporary table to target name
  statements.push(`ALTER TABLE ${sql(tempTableName)} RENAME TO ${sql(targetTable.name)};`);

  // Recreate dependent objects that were dropped with the old table. Triggers
  // and views may refer to objects later operations create or rename, so
  // they are put back once every ALTER TABLE has run.
  for (const index of targetIndexes) {
    statements.push(generateCreateIndexDDL(index));
  }
  for (const trigger of targetTriggers) {
    state.deferred.set(triggerKey(trigger.name), generateCreateTriggerDDL(trigger));
  }
  for (const view of targetViews) deferView(state, view);

  return statements;
}

// Build a mapping of target column names to source column names,
// detecting renamed columns via heuristic matching
function buildColumnMapping(
  currentColumns: Column[],
  targetColumns: Column[],
  generatedColumns: Set<string>,
): { source: string; target: string }[] {
  const mapping: { source: string; target: string }[] = [];
  const currentByName = new Map(currentColumns.map((col) => [col.name, col]));

  // First pass: match columns with the same name
  const unmatchedTarget: Column[] = [];
  for (const targetCol of targetColumns) {
    if (generatedColumns.has(targetCol.name)) continue;
    if (currentByName.has(targetCol.name)) {
      mapping.push({ source: targetCol.name, target: targetCol.name });
    } else {
      unmatchedTarget.push(targetCol);
    }
  }

  // Second pass: detect renames among unmatched columns
  if (unmatchedTarget.length > 0) {
    const matchedTargetNames = new Set(mapping.map((m) => m.target));
    const unmatchedCurrent = currentColumns.filter((col) => !matchedTargetNames.has(col.name));

    const matchedCurrentIdxs = new Set<number>();
    for (const targetCol of unmatchedTarget) {
      for (const [i, currentCol] of unmatchedCurrent.entries()) {
        if (matchedCurrentIdxs.has(i)) continue;
        if (columnsLookLikeRename(currentCol, targetCol, true)) {
          mapping.push({ source: currentCol.name, target: targetCol.name });
          matchedCurrentIdxs.add(i);
          break;
        }
      }
    }

    // Relaxed pass for remaining unmatched
    for (const targetCol of unmatchedTarget) {
      if (mapping.some((m) => m.target === targetCol.name)) continue;
      for (const [i, currentCol] of unmatchedCurrent.entries()) {
        if (matchedCurrentIdxs.has(i)) continue;
        if (columnsLookLikeRename(currentCol, targetCol, false)) {
          mapping.push({ source: currentCol.name, target: targetCol.name });
          matchedCurrentIdxs.add(i);
          break;
        }
      }
    }
  }

  return mapping;
}
