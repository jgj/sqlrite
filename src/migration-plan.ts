import type { SchemaDiff } from "./compare/types";
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
  type CreateOperation,
  type DropOperation,
  type MigrationOperation,
  type RebuildOperation,
  type RecreateOperation,
  type RecreateReason,
  type RenameOperation,
  type VirtualTableRecreateOperation,
  getTableRenameMap,
} from "./migration-operation";
import type { MigrationOptions } from "./migration-statements";
import {
  columnsLookLikeRename,
  findByName,
  findViewsDependingOnTable,
  foldName,
  invariant,
  sameNames,
} from "./utils";
import {
  getVirtualTableModule,
  resolveVirtualTable,
  sameModule,
  virtualTableDifferences,
} from "./virtual-tables/registry";
import type { DependencyReaction } from "./virtual-tables/types";

export function createMigrationPlan(
  diff: SchemaDiff,
  options: MigrationOptions = {},
): MigrationPlan {
  /*
    The only schema altering commands directly supported by SQLite are:
      - "rename table"
      - "rename column"
      - "add column"
      - "drop column"

    For all other schema changes, we need to recreate the table.
  */

  let [tableCreates, tableDrops, tableRenames] = getTableRenames(diff);

  // Get all tables that need to be recreated
  const tableRecreates = getTableRecreates(diff, options);
  // Tables whose dependent objects are dropped and recreated by the recreate
  // itself (see generate-ddl), or left alone (kept)
  const ignore = new Set(tableRecreates.map((t) => t.target.name));
  const recreated = new Set(ignore);
  // Tables and virtual tables kept by ignoreTableDeletion
  const kept = new Set<string>();

  // ignoreTableDeletion: suppress drop operations and treat these tables as
  // ignored so dependent indexes/triggers/views aren't dropped either. This
  // runs after the rename heuristic, so drop+create pairs still resolve to
  // renames as usual — only true deletions are suppressed.
  if (options.ignoreTableDeletion) {
    // A table whose name the desired schema gives to a virtual table is
    // replaced, not deleted: it is dropped to free the name
    const replaced = (drop: DropOperation<Table>) =>
      options.manageVirtualTables === true &&
      findByName(diff.desired.virtual_tables, drop.current.name) !== undefined;
    for (const drop of tableDrops) {
      if (replaced(drop)) continue;
      ignore.add(drop.current.name);
      kept.add(drop.current.name);
    }
    tableDrops = tableDrops.filter(replaced);
  }

  // Virtual tables are only touched when opted in; with the flag off they are
  // never created, dropped, altered or warned about.
  const virtualTables = options.manageVirtualTables
    ? getVirtualTableOperations(diff, options, tableRecreates, tableRenames)
    : emptyVirtualTableOperations();
  for (const name of virtualTables.ignore) {
    ignore.add(name);
    recreated.add(name);
  }
  for (const name of virtualTables.kept) {
    ignore.add(name);
    kept.add(name);
  }

  const columnRenames = getColumnRenames(diff, ignore);

  // Track columns involved in renames to exclude them from adds/drops
  const renamedColumns = new Set<string>();
  for (const rename of columnRenames) {
    if (rename.current && rename.target) {
      // Use a unique identifier for the column
      renamedColumns.add(`${rename.current.table}.${rename.current.name}`);
      renamedColumns.add(`${rename.target.table}.${rename.target.name}`);
    }
  }

  const columnAdds = getColumnAdds(diff, ignore, renamedColumns);
  const columnDrops = getColumnDrops(diff, ignore, renamedColumns);
  const indexDrops = getIndexDrops(diff, ignore);
  const indexCreates = getIndexCreates(diff, ignore);
  const triggerDrops = getTriggerDrops(diff, ignore);
  const triggerCreates = getTriggerCreates(diff, ignore);
  const viewDiff = withoutViewTableChanges(diff, viewTablesToIgnore(diff, kept, options));
  const viewDrops = getViewDrops(viewDiff, kept, recreated);
  const viewCreates = getViewCreates(viewDiff, recreated);

  // Renames of tables and virtual tables, ordered so that a rename into a
  // name runs after the rename that frees it. A table drop that frees a name
  // a rename takes (a table replaced by a renamed virtual table, or a table
  // named like one of the renamed virtual table's new shadow tables) runs
  // first.
  const renames = orderRenames([...tableRenames, ...virtualTables.renames]);
  const renameTargets = new Set(renames.flatMap(takenNames));
  const freeingDrops = tableDrops.filter((d) => renameTargets.has(foldName(d.current.name)));
  const otherDrops = tableDrops.filter((d) => !freeingDrops.includes(d));
  const vtRecreates = splitVirtualTableRecreates(
    virtualTables.recreates,
    [
      ...tableCreates.map((c) => c.target.name),
      ...tableRenames.map((r) => r.target.name),
      // Virtual tables created or renamed here take their shadow table names
      // too; both run before the late step of a recreate
      ...virtualTables.creates.flatMap((c) => heldNames(c.target)),
      ...virtualTables.renames.flatMap(takenNames),
    ],
    diff.desired,
    getTableRenameMap(tableRenames),
  );

  return [
    // Virtual tables whose rows are read, or whose shadow table names are
    // freed, before anything else changes (see splitVirtualTableRecreates)
    ...vtRecreates.early,
    ...viewDrops, // Drop views first since they may depend on tables
    ...triggerDrops, // Drop triggers before modifying tables they rely on
    ...indexDrops, // Drop indexes before modifying their tables
    ...virtualTables.drops, // Drop virtual tables before the tables they may read from change

    ...tableRecreates, // Recreate tables (involves dropping and recreating)
    ...freeingDrops, // Drop tables whose name a rename takes
    ...renames, // Rename tables and virtual tables, before any create takes a freed name
    ...otherDrops, // Drop tables that aren't being recreated
    ...tableCreates, // Create new tables

    ...columnRenames, // Rename columns
    ...columnDrops, // Drop columns
    ...columnAdds, // Add columns

    // Virtual tables once their base tables are final, and before the triggers
    // (e.g. FTS sync triggers) and views that reference them
    ...virtualTables.creates,
    ...vtRecreates.late,

    ...indexCreates, // Recreate indexes
    ...triggerCreates, // Recreate triggers
    ...viewCreates, // Recreate views

    // Rebuilds read from content tables and views, so they run once every
    // table and view exists (generate-ddl also creates the triggers and views
    // of recreated tables before them)
    ...virtualTables.rebuilds,
  ];
}

/**
 * A virtual table recreate normally runs after every table operation. It is
 * split in two steps, its drop step running first, before anything else
 * changes, and its create step where the recreate would have run, when:
 * - a create or rename of a table or virtual table takes the name of one of
 *   the current virtual table's shadow tables (e.g. an own-content FTS5 table
 *   docs becomes external content over a new table docs_content): the shadow
 *   table holds that name until the virtual table is dropped, and the new
 *   virtual table may reserve it again
 * - the handler reads the rows to carry through the current virtual table
 *   from a relation later operations may drop (dropFirst)
 */
function splitVirtualTableRecreates(
  recreates: VirtualTableRecreateOperation[],
  takenNames: string[],
  desired: IntrospectionResult,
  renamedTables: ReadonlyMap<string, string>,
): { early: VirtualTableRecreateOperation[]; late: VirtualTableRecreateOperation[] } {
  const taken = new Set(takenNames.map(foldName));
  const early: VirtualTableRecreateOperation[] = [];
  const late: VirtualTableRecreateOperation[] = [];

  for (const op of recreates) {
    const { handler, args } = resolveVirtualTable(op.current);
    const shadows = handler.shadowTables?.(args) ?? [];
    const freesName = shadows.some((suffix) => taken.has(foldName(`${op.current.name}_${suffix}`)));
    const readsFirst =
      sameModule(op.current, op.target) &&
      handler.recreateSteps !== undefined &&
      handler.dropFirst?.({
        current: op.current,
        target: op.target,
        currentArgs: args,
        targetArgs: handler.parseArgs(op.target.args),
        desired,
        renamedTables,
      }) === true;
    if (!freesName && !readsFirst) {
      late.push(op);
      continue;
    }
    early.push({ ...op, step: "drop" });
    late.push({ ...op, step: "create" });
  }

  return { early, late };
}

/**
 * The names (folded) a table or virtual table under `name` holds: its own,
 * and those of the shadow tables of a virtual table. ALTER TABLE ... RENAME of
 * a virtual table renames its shadow tables along with it, so a rename frees
 * every name the current table holds and takes every name the target holds.
 */
function heldNames(table: Table | VirtualTable, name = table.name): string[] {
  if (table.type !== "virtual_table") return [foldName(name)];
  const { handler, args } = resolveVirtualTable(table);
  const shadows = handler.shadowTables?.(args) ?? [];
  return [name, ...shadows.map((suffix) => `${name}_${suffix}`)].map(foldName);
}

/** The names (folded) a rename takes (see heldNames) */
function takenNames(op: RenameOperation<Table | VirtualTable>): string[] {
  return heldNames(op.current, op.target.name);
}

/** A rename of `op.current` to `name`, keeping the object's other details */
function renameTo(
  op: RenameOperation<Table | VirtualTable>,
  current: string,
  target: string,
): RenameOperation<Table | VirtualTable> {
  return {
    type: "rename",
    current: { ...op.current, name: current },
    target: { ...op.target, name: target },
  } as RenameOperation<Table | VirtualTable>;
}

/**
 * Order renames so that each one runs after the rename that frees a name it
 * takes (`x → y` after `y → z`), shadow table names included (see heldNames).
 * Independent renames keep their order. A cycle (a swap) is broken by
 * renaming one table through a temporary name. So is a virtual table rename
 * that takes a name its own current shadow tables hold (x → x_data), or whose
 * new shadow tables take its current name (x_data → x).
 */
function orderRenames(
  renames: RenameOperation<Table | VirtualTable>[],
): RenameOperation<Table | VirtualTable>[] {
  const temporaryName = (op: RenameOperation<Table | VirtualTable>) =>
    `sqlrite_rename_${op.target.name}`;
  const pending: RenameOperation<Table | VirtualTable>[] = [];
  const ordered: RenameOperation<Table | VirtualTable>[] = [];
  for (const op of renames) {
    const holds = new Set(heldNames(op.current));
    if (!takenNames(op).some((name) => holds.has(name))) {
      pending.push(op);
      continue;
    }
    // Moving it aside first only frees names; nothing else takes the
    // temporary one
    const temporary = temporaryName(op);
    ordered.push(renameTo(op, op.current.name, temporary));
    pending.push(renameTo(op, temporary, op.target.name));
  }
  // A rename can run once no other pending rename still holds a name it takes
  const blocked = (op: RenameOperation<Table | VirtualTable>) => {
    const takes = new Set(takenNames(op));
    return pending.some(
      (other) => other !== op && heldNames(other.current).some((name) => takes.has(name)),
    );
  };

  while (pending.length > 0) {
    const index = pending.findIndex((op) => !blocked(op));
    if (index !== -1) {
      ordered.push(...pending.splice(index, 1));
      continue;
    }

    // Every pending rename waits on another: move the first one aside
    const [op] = pending.splice(0, 1);
    invariant(op, "Rename cycle without a rename");
    const temporary = temporaryName(op);
    ordered.push(renameTo(op, op.current.name, temporary));
    pending.push(renameTo(op, temporary, op.target.name));
  }

  return ordered;
}

function getTableCreates(diff: SchemaDiff): CreateOperation<Table>[] {
  return diff.table.added.map((target) => ({
    type: "create",
    target,
  }));
}

function getTableDrops(diff: SchemaDiff): DropOperation<Table>[] {
  return diff.table.removed.map((current) => ({
    type: "drop",
    current,
  }));
}

function getTableRenames(diff: SchemaDiff) {
  const creates = getTableCreates(diff);
  const drops = getTableDrops(diff);
  const renames = new Array<RenameOperation<Table>>();

  const createMap = new Map(creates.map((c) => [c.target.name, c]));
  const removeFromArrays = new Set<string>();

  for (const drop of drops) {
    for (const [createName, create] of createMap) {
      if (
        drop.current.sql.replace(drop.current.name, "") ===
        create.target.sql.replace(create.target.name, "")
      ) {
        renames.push({
          type: "rename",
          current: drop.current,
          target: create.target,
        });
        removeFromArrays.add(drop.current.name);
        removeFromArrays.add(createName);
      }
    }
  }

  return [
    creates.filter((c) => !removeFromArrays.has(c.target.name)),
    drops.filter((d) => !removeFromArrays.has(d.current.name)),
    renames,
  ] as const;
}

type RecreateReasonMap = Map<string, RecreateReason[]>;

function recordRecreate(
  reasons: RecreateReasonMap,
  tableName: string,
  check: string,
  detail: string,
): void {
  let list = reasons.get(tableName);
  if (!list) {
    list = [];
    reasons.set(tableName, list);
  }
  list.push({ check, detail });
}

function getTableRecreates(diff: SchemaDiff, options: MigrationOptions): RecreateOperation[] {
  const result = new Array<RecreateOperation>();
  const reasons: RecreateReasonMap = new Map();

  // Get mapping of table name to modified table objects
  const modifiedTables = new Map(
    diff.table.modified.map(({ current, desired }) => [current.name, { current, desired }]),
  );

  // Check for column changes that require table recreation
  checkColumnsForRecreation(diff, reasons, options);

  // Check for primary key changes that require table recreation
  checkPrimaryKeysForRecreation(diff, reasons);

  // Check for foreign key changes that require table recreation
  checkForeignKeysForRecreation(diff, reasons);

  // Check for index changes that might require table recreation
  checkIndicesForRecreation(diff, reasons);

  // Check for tables that would have previously been rewritten
  checkTablesForConstraintChanges(diff, reasons, options);

  // Generate RecreateOperations for identified tables
  for (const [tableName, tableReasons] of reasons) {
    const modifiedTable = modifiedTables.get(tableName);
    if (modifiedTable) {
      result.push({
        type: "recreate",
        current: modifiedTable.current,
        target: modifiedTable.desired,
        reasons: tableReasons,
      });
    }
  }

  return result;
}

function checkColumnsForRecreation(
  diff: SchemaDiff,
  reasons: RecreateReasonMap,
  options: MigrationOptions,
): void {
  // Group columns by table for easier analysis
  const columnsByTable = new Map<string, { current: Column[]; desired: Column[] }>();

  // Initialize the map with tables from modified columns
  for (const { current } of diff.column.modified) {
    if (!columnsByTable.has(current.table)) {
      columnsByTable.set(current.table, { current: [], desired: [] });
    }
  }

  // Populate the current columns
  for (const column of diff.column.modified.map((m) => m.current)) {
    const tableColumns = columnsByTable.get(column.table);
    if (tableColumns) {
      tableColumns.current.push(column);
    }
  }

  // Populate the desired columns
  for (const column of diff.column.modified.map((m) => m.desired)) {
    const tableColumns = columnsByTable.get(column.table);
    if (tableColumns) {
      tableColumns.desired.push(column);
    }
  }

  // Handle added columns that can't use ALTER TABLE ADD COLUMN
  for (const column of diff.column.added) {
    // Skip columns on newly created tables
    if (diff.table.added.some((t) => t.name === column.table)) continue;

    // SQLite requires that NOT NULL columns added via ALTER TABLE have a default value
    if (!column.nullable && (!column.default || column.default.trim() === "")) {
      recordRecreate(
        reasons,
        column.table,
        "column.added.not_null_no_default",
        `Added column "${column.name}" is NOT NULL without a default; ALTER TABLE ADD COLUMN cannot be used`,
      );
    }

    // Generated columns require recreation — ALTER TABLE ADD COLUMN doesn't
    // include the GENERATED ALWAYS AS clause in the column definition
    if (column.generated !== "none") {
      recordRecreate(
        reasons,
        column.table,
        "column.added.generated",
        `Added column "${column.name}" is generated (${column.generated}); ALTER TABLE ADD COLUMN omits GENERATED clause`,
      );
    }
  }

  // Handle dropped columns - only require recreation if the column is not at the end
  for (const column of diff.column.removed) {
    const table = diff.current.tables.find((t) => t.name === column.table);
    invariant(
      table,
      `Table '${column.table}' for column '${column.name}' is not in current schema`,
    );
    if (column.ordinal_position + 1 < table.num_cols) {
      recordRecreate(
        reasons,
        column.table,
        "column.removed.not_last",
        `Dropped column "${column.name}" is at ordinal ${column.ordinal_position} of ${table.num_cols}; not the last column`,
      );
    }
  }

  // Analyze column changes for each table
  for (const [tableName, { current, desired }] of columnsByTable.entries()) {
    // Check if column order has changed
    if (hasColumnOrderChanged(current, desired)) {
      if (!options.ignoreColumnOrder) {
        recordRecreate(
          reasons,
          tableName,
          "column.order_changed",
          "Column ordering differs between current and desired",
        );
        continue;
      }
      // option on: don't record reorder reason; fall through so other column-level
      // changes (data_type, nullable, etc.) on this table still get checked
    }

    // Check for data type changes, nullability changes, etc.
    for (const modification of diff.column.modified) {
      if (modification.current.table === tableName) {
        const { changes, current: c, desired: d } = modification;

        // Data type changes require recreation
        if (changes.includes("data_type")) {
          recordRecreate(
            reasons,
            tableName,
            "column.modified.data_type",
            `Column "${c.name}" data_type changed: ${c.data_type} → ${d.data_type}`,
          );
          break;
        }

        // Change from NULL to NOT NULL requires recreation
        // Change from NOT NULL to NULL is handled directly with ALTER TABLE
        if (changes.includes("nullable") && c.nullable && !d.nullable) {
          recordRecreate(
            reasons,
            tableName,
            "column.modified.nullable_tightened",
            `Column "${c.name}" changed from NULL to NOT NULL`,
          );
          break;
        }

        // Precision or character length changes require recreation
        if (changes.includes("precision") || changes.includes("character_maximum_length")) {
          recordRecreate(
            reasons,
            tableName,
            "column.modified.precision_or_length",
            `Column "${c.name}" precision/length changed (changes: ${changes.join(", ")})`,
          );
          break;
        }

        // Check constraint changes require recreation
        if (changes.includes("check_constraint")) {
          recordRecreate(
            reasons,
            tableName,
            "column.modified.check_constraint",
            `Column "${c.name}" CHECK constraint changed: ${c.check_constraint ?? "<none>"} → ${d.check_constraint ?? "<none>"}`,
          );
          break;
        }

        // AUTOINCREMENT changes require recreation
        if (changes.includes("autoincrement")) {
          recordRecreate(
            reasons,
            tableName,
            "column.modified.autoincrement",
            `Column "${c.name}" AUTOINCREMENT changed: ${c.autoincrement} → ${d.autoincrement}`,
          );
          break;
        }

        // Generated column changes require recreation
        if (changes.includes("generated")) {
          recordRecreate(
            reasons,
            tableName,
            "column.modified.generated",
            `Column "${c.name}" generated changed: ${c.generated} → ${d.generated}`,
          );
          break;
        }
      }
    }
  }
}

function hasColumnOrderChanged(current: Column[], desired: Column[]): boolean {
  // Sort by ordinal position
  const currentSorted = [...current].sort((a, b) => a.ordinal_position - b.ordinal_position);
  const desiredSorted = [...desired].sort((a, b) => a.ordinal_position - b.ordinal_position);

  // Check if the column order is the same
  return currentSorted.some(
    (column, index) => desiredSorted[index] && column.name !== desiredSorted[index].name,
  );
}

function checkPrimaryKeysForRecreation(diff: SchemaDiff, reasons: RecreateReasonMap): void {
  // Added primary keys require recreation
  for (const pk of diff.primary_key.added) {
    recordRecreate(
      reasons,
      pk.table,
      "primary_key.added",
      `Primary key added on column(s) "${pk.column}"`,
    );
  }

  // Modified primary keys require recreation
  for (const { current, desired } of diff.primary_key.modified) {
    recordRecreate(
      reasons,
      current.table,
      "primary_key.modified",
      `Primary key changed: "${current.column}" → "${desired.column}"`,
    );
  }

  // Removed primary keys require recreation
  for (const pk of diff.primary_key.removed) {
    recordRecreate(
      reasons,
      pk.table,
      "primary_key.removed",
      `Primary key removed from column(s) "${pk.column}"`,
    );
  }
}

function checkForeignKeysForRecreation(diff: SchemaDiff, reasons: RecreateReasonMap): void {
  // Adding foreign keys requires recreation
  for (const fk of diff.foreign_key.added) {
    recordRecreate(
      reasons,
      fk.table,
      "foreign_key.added",
      `Foreign key added: "${fk.column}" → ${fk.referenced_table}("${fk.referenced_column}")`,
    );
  }

  // Check modified foreign keys
  for (const { current, desired, changes } of diff.foreign_key.modified) {
    // If we're changing anything other than dropping constraints, we need recreation
    const nonRemovalChanges = changes.filter(
      (change) => change !== "on_update" && change !== "on_delete" && change !== "definition",
    );

    if (nonRemovalChanges.length > 0) {
      recordRecreate(
        reasons,
        current.table,
        "foreign_key.modified",
        `Foreign key on "${current.column}" changed (changes: ${nonRemovalChanges.join(", ")}); current="${current.definition}", desired="${desired.definition}"`,
      );
    }
  }
}

function checkIndicesForRecreation(diff: SchemaDiff, reasons: RecreateReasonMap): void {
  // Adding unique indices requires recreation
  for (const index of diff.index.added) {
    if (index.unique) {
      recordRecreate(
        reasons,
        index.table,
        "index.added.unique",
        `Unique index "${index.name}" added on (${index.columns.join(", ")})`,
      );
    }
  }

  // Check for modified indices where uniqueness has changed
  for (const { current, desired, changes } of diff.index.modified) {
    if (changes.includes("unique") && !current.unique && desired.unique) {
      recordRecreate(
        reasons,
        current.table,
        "index.modified.unique_added",
        `Index "${desired.name}" gained UNIQUE constraint`,
      );
    }
  }
}

function checkTablesForConstraintChanges(
  diff: SchemaDiff,
  reasons: RecreateReasonMap,
  options: MigrationOptions,
): void {
  // Identify tables with DEFAULT value changes or NOT NULL constraint changes
  for (const { current, desired, changes } of diff.column.modified) {
    // Default value changes require recreation
    if (changes.includes("default")) {
      recordRecreate(
        reasons,
        current.table,
        "column.modified.default",
        `Column "${current.name}" default changed: "${current.default}" → "${desired.default}"`,
      );
    }

    // NOT NULL constraint removal (NOT NULL → NULL) requires recreation
    // SQLite has no ALTER COLUMN — this can only be done via table recreation
    if (changes.includes("nullable") && !current.nullable && desired.nullable) {
      recordRecreate(
        reasons,
        current.table,
        "column.modified.nullable_loosened",
        `Column "${current.name}" changed from NOT NULL to NULL`,
      );
    }
  }

  // Identify tables with FOREIGN KEY constraint removals
  for (const fk of diff.foreign_key.removed) {
    recordRecreate(
      reasons,
      fk.table,
      "foreign_key.removed",
      `Foreign key removed: "${fk.column}" → ${fk.referenced_table}("${fk.referenced_column}")`,
    );
  }

  // Identify tables with FK on_update/on_delete changes (also requires recreation)
  for (const { current, desired, changes } of diff.foreign_key.modified) {
    if (changes.includes("on_update") || changes.includes("on_delete")) {
      recordRecreate(
        reasons,
        current.table,
        "foreign_key.modified.action",
        `Foreign key on "${current.column}" action changed: on_update ${current.on_update}→${desired.on_update}, on_delete ${current.on_delete}→${desired.on_delete}`,
      );
    }
  }

  // Catch remaining constraint changes (table-level CHECK, etc.) by comparing SQL
  // but only for tables whose SQL difference is NOT already explained by
  // column adds, drops, or renames
  for (const { current, desired } of diff.table.modified) {
    if (current.sql === desired.sql) continue;

    // If this table has column adds, drops, or renames, those explain the SQL difference
    if (tableHasColumnStructureChanges(current.name, diff)) continue;

    // With ignoreColumnOrder on, a pure reorder makes the SQL string differ but
    // is intentionally being ignored — don't let table.sql_diff reintroduce the
    // recreate the column.order_changed branch already declined to record.
    if (options.ignoreColumnOrder && tableHasOnlyColumnReorder(current.name, diff)) continue;

    // Remaining SQL differences are constraint-level changes requiring recreation
    recordRecreate(
      reasons,
      current.name,
      "table.sql_diff",
      `Table SQL differs and no column add/drop/rename explains it.\n  current.sql:\n    ${current.sql}\n  desired.sql:\n    ${desired.sql}`,
    );
  }
}

// True when the only column-level differences for this table are ordinal_position
// changes — i.e. the SQL string differs solely because columns were reordered.
function tableHasOnlyColumnReorder(tableName: string, diff: SchemaDiff): boolean {
  const mods = diff.column.modified.filter((m) => m.current.table === tableName);
  if (mods.length === 0) return false;
  return mods.every((m) => m.changes.length === 1 && m.changes[0] === "ordinal_position");
}

// Check if a table's SQL difference is explained by column-level operations
// (adds, drops, renames) that are handled via ALTER TABLE
function tableHasColumnStructureChanges(tableName: string, diff: SchemaDiff): boolean {
  const hasAdds = diff.column.added.some((col) => col.table === tableName);
  const hasDrops = diff.column.removed.some((col) => col.table === tableName);
  const hasRenames =
    diff.column.added.some((col) => col.table === tableName) &&
    diff.column.removed.some((col) => col.table === tableName);

  return hasAdds || hasDrops || hasRenames;
}

function getColumnRenames(
  diff: SchemaDiff,
  tablesToIgnore: Set<string>,
): RenameOperation<Column>[] {
  const result = new Array<RenameOperation<Column>>();

  // Filter out ignored tables
  const removedColumns = diff.column.removed.filter((col) => !tablesToIgnore.has(col.table));
  const addedColumns = diff.column.added.filter((col) => !tablesToIgnore.has(col.table));

  // If we have no removed or added columns, there can't be any renames
  if (removedColumns.length === 0 || addedColumns.length === 0) {
    return result;
  }

  // Group by table for faster lookup
  const removedByTable = groupColumnsByTable(removedColumns);
  const addedByTable = groupColumnsByTable(addedColumns);

  // Process tables that have both removals and additions
  const tablesWithBoth = Object.keys(removedByTable).filter((table) => table in addedByTable);

  for (const tableName of tablesWithBoth) {
    const removed = removedByTable[tableName];
    const added = addedByTable[tableName];
    if (!removed || !added) continue;

    // Track which columns have been matched to avoid double-matching
    const matchedAdded = new Set<number>();
    const matchedRemoved = new Set<number>();

    // First pass: look for highly similar columns (strong matches)
    for (const [i, removedCol] of removed.entries()) {
      if (matchedRemoved.has(i)) continue;

      for (const [j, addedCol] of added.entries()) {
        if (matchedAdded.has(j)) continue;

        if (columnsLookLikeRename(removedCol, addedCol, true)) {
          result.push(createRenameOperation(removedCol, addedCol));
          matchedRemoved.add(i);
          matchedAdded.add(j);
          break;
        }
      }
    }

    // Second pass: look for columns that are similar but might have some differences
    for (const [i, removedCol] of removed.entries()) {
      if (matchedRemoved.has(i)) continue;

      for (const [j, addedCol] of added.entries()) {
        if (matchedAdded.has(j)) continue;

        if (columnsLookLikeRename(removedCol, addedCol, false)) {
          result.push(createRenameOperation(removedCol, addedCol));
          matchedRemoved.add(i);
          matchedAdded.add(j);
          break;
        }
      }
    }
  }

  return result;
}

function createRenameOperation(removed: Column, added: Column): RenameOperation<Column> {
  return {
    type: "rename",
    current: removed,
    target: added,
  };
}

function groupColumnsByTable(columns: Column[]): Record<string, Column[]> {
  return columns.reduce<Record<string, Column[]>>((groups, column) => {
    const group = groups[column.table] ?? [];
    group.push(column);
    groups[column.table] = group;
    return groups;
  }, {});
}

function getColumnAdds(
  diff: SchemaDiff,
  tablesToIgnore: Set<string>,
  renamedColumns: Set<string> = new Set(),
): CreateOperation<Column>[] {
  // Add columns are supported directly in SQLite
  return diff.column.added
    .filter(
      (column) =>
        !tablesToIgnore.has(column.table) &&
        !renamedColumns.has(`${column.table}.${column.name}`) &&
        !diff.table.added.some((t) => t.name === column.table),
    )
    .map((column) => ({
      type: "create",
      target: column,
    }));
}

function getColumnDrops(
  diff: SchemaDiff,
  tablesToIgnore: Set<string>,
  renamedColumns: Set<string> = new Set(),
): DropOperation<Column>[] {
  // Drop columns are supported directly in SQLite as of version 3.35.0
  return diff.column.removed
    .filter(
      (column) =>
        !tablesToIgnore.has(column.table) &&
        !renamedColumns.has(`${column.table}.${column.name}`) &&
        !diff.table.removed.some((t) => t.name === column.table),
    )
    .map((column) => ({
      type: "drop",
      current: column,
    }));
}

function getIndexDrops(diff: SchemaDiff, tablesToIgnore: Set<string>): DropOperation<Index>[] {
  const removed = diff.index.removed.filter(
    (index) => !tablesToIgnore.has(index.table) && !index.name.startsWith("sqlite_autoindex"),
  );
  // Modified indexes need to be dropped and recreated
  const modified = diff.index.modified
    .filter(
      ({ current }) =>
        !tablesToIgnore.has(current.table) && !current.name.startsWith("sqlite_autoindex"),
    )
    .map(({ current }) => current);

  return [...removed, ...modified].map((index) => ({
    type: "drop",
    current: index,
  }));
}

function getIndexCreates(diff: SchemaDiff, tablesToIgnore: Set<string>): CreateOperation<Index>[] {
  const added = diff.index.added.filter(
    (index) => !tablesToIgnore.has(index.table) && !index.name.startsWith("sqlite_autoindex"),
  );
  // Modified indexes need to be dropped and recreated
  const modified = diff.index.modified
    .filter(
      ({ desired }) =>
        !tablesToIgnore.has(desired.table) && !desired.name.startsWith("sqlite_autoindex"),
    )
    .map(({ desired }) => desired);

  return [...added, ...modified].map((index) => ({
    type: "create",
    target: index,
  }));
}

function getTriggerDrops(diff: SchemaDiff, tablesToIgnore: Set<string>): DropOperation<Trigger>[] {
  const removed = diff.trigger.removed.filter((trigger) => !tablesToIgnore.has(trigger.table));
  const modified = diff.trigger.modified
    .filter(({ current }) => !tablesToIgnore.has(current.table))
    .map(({ current }) => current);

  return [...removed, ...modified].map((trigger) => ({
    type: "drop",
    current: trigger,
  }));
}

function getTriggerCreates(
  diff: SchemaDiff,
  tablesToIgnore: Set<string>,
): CreateOperation<Trigger>[] {
  const added = diff.trigger.added.filter((trigger) => !tablesToIgnore.has(trigger.table));
  const modified = diff.trigger.modified
    .filter(({ desired }) => !tablesToIgnore.has(desired.table))
    .map(({ desired }) => desired);

  return [...added, ...modified].map((trigger) => ({
    type: "create",
    target: trigger,
  }));
}

// - kept: removed views that read these tables (kept by ignoreTableDeletion)
//   are left alone; a recreate of another table they read drops them and puts
//   them back (see getKeptViews in generate-ddl)
// - recreated: views that read these tables are dropped and recreated by the
//   recreate itself (see generate-ddl)
// A removed view that reads a recreated table is dropped here, before the
// recreate: the recreate only drops the views it puts back, and a view left
// reading the table while it is missing makes its ALTER TABLE ... RENAME fail.
function getViewDrops(
  diff: SchemaDiff,
  kept: Set<string>,
  recreated: Set<string>,
): DropOperation<View>[] {
  const removed = diff.view.removed.filter((view) => !view.tables.some((table) => kept.has(table)));
  const modified = diff.view.modified
    .filter(({ current }) => !current.tables.some((table) => recreated.has(table)))
    .map(({ current }) => current);

  return [...removed, ...modified].map((view) => ({
    type: "drop",
    current: view,
  }));
}

function getViewCreates(diff: SchemaDiff, recreated: Set<string>): CreateOperation<View>[] {
  const added = diff.view.added.filter(
    (view) => !view.tables.some((table) => recreated.has(table)),
  );
  const modified = diff.view.modified
    .filter(({ desired }) => !desired.tables.some((table) => recreated.has(table)))
    .map(({ desired }) => desired);

  return [...added, ...modified].map((view) => ({
    type: "create",
    target: view,
  }));
}

// Names (folded) whose presence in view.tables alone does not make a view
// modified:
// - a table or virtual table kept by ignoreTableDeletion is missing from the
//   desired schema, so a view that reads it resolves to fewer tables there
// - view.tables includes the virtual tables a view reads from; with virtual
//   tables unmanaged, which virtual tables a view resolves to (e.g. the desired
//   schema omits one the view reads from) is left alone, as it was before
//   virtual tables were introspected
// Otherwise the view would be dropped and recreated on every run.
function viewTablesToIgnore(
  diff: SchemaDiff,
  kept: Set<string>,
  options: MigrationOptions,
): Set<string> {
  const names = [...kept];
  if (!options.manageVirtualTables) {
    names.push(
      ...[...diff.current.virtual_tables, ...diff.desired.virtual_tables].map((vt) => vt.name),
    );
  }
  return new Set(names.map(foldName));
}

// Leave out the views whose only change is to the tables in `ignored`
function withoutViewTableChanges(diff: SchemaDiff, ignored: Set<string>): SchemaDiff {
  if (ignored.size === 0) return diff;

  const tables = (view: View) => view.tables.filter((t) => !ignored.has(foldName(t)));
  const modified = diff.view.modified.filter(
    ({ current, desired, changes }) =>
      changes.some((change) => change !== "tables") || !sameNames(tables(current), tables(desired)),
  );

  return { ...diff, view: { ...diff.view, modified } };
}

type VirtualTableOperations = {
  drops: DropOperation<VirtualTable>[];
  renames: RenameOperation<VirtualTable>[];
  creates: CreateOperation<VirtualTable>[];
  recreates: VirtualTableRecreateOperation[];
  rebuilds: RebuildOperation[];
  // Names whose dependent views are handled by the virtual table operation
  // itself, like `ignore` for recreated tables
  ignore: string[];
  // Virtual tables kept by ignoreTableDeletion; their dependent views are
  // left alone
  kept: string[];
};

function emptyVirtualTableOperations(): VirtualTableOperations {
  return {
    drops: [],
    renames: [],
    creates: [],
    recreates: [],
    rebuilds: [],
    ignore: [],
    kept: [],
  };
}

function getVirtualTableOperations(
  diff: SchemaDiff,
  options: MigrationOptions,
  tableRecreates: RecreateOperation[],
  tableRenames: RenameOperation<Table>[],
): VirtualTableOperations {
  const { creates, drops: allDrops, renames } = getVirtualTableRenames(diff);
  const ignore: string[] = [];
  const kept: string[] = [];

  // ignoreTableDeletion keeps virtual tables missing from the desired schema,
  // along with the views that depend on them. A virtual table whose name the
  // desired schema gives to a regular table is replaced, not deleted: it is
  // dropped to free the name.
  let drops = allDrops;
  if (options.ignoreTableDeletion) {
    const replaced = (drop: DropOperation<VirtualTable>) =>
      findByName(diff.desired.tables, drop.current.name) !== undefined;
    kept.push(...drops.filter((d) => !replaced(d)).map((d) => d.current.name));
    drops = drops.filter(replaced);
  }

  const recreates: VirtualTableRecreateOperation[] = diff.virtual_table.modified.map(
    ({ current, desired }) => ({
      type: "recreate",
      current,
      target: desired,
      reasons: virtualTableDifferences(current, desired),
    }),
  );

  const rebuilds = new Array<RebuildOperation>();
  const skip = new Set([
    ...creates.map((c) => c.target.name),
    ...recreates.map((r) => r.target.name),
  ]);

  for (const target of diff.desired.virtual_tables) {
    if (skip.has(target.name)) continue;

    const reaction = getDependencyReaction(target, tableRecreates, tableRenames, diff);
    if (!reaction) continue;

    if (reaction.type === "rebuild") {
      rebuilds.push({ type: "rebuild", target, reasons: reaction.reasons });
      continue;
    }

    // A pending rename becomes part of the recreate (DROP old + CREATE new)
    const renameIndex = renames.findIndex((r) => r.target.name === target.name);
    const [rename] = renameIndex === -1 ? [] : renames.splice(renameIndex, 1);
    const current = rename?.current ?? findByName(diff.current.virtual_tables, target.name);
    invariant(current, `Virtual table "${target.name}" is not in the current schema`);
    recreates.push({ type: "recreate", current, target, reasons: reaction.reasons });
  }

  for (const { current, target } of recreates) {
    ignore.push(current.name, target.name);
  }

  // A virtual table that reads from a view (FTS5 content=<view>) and is
  // created or recreated here is filled when it is created, but the view may
  // only be created at the end of the migration: a new or changed view, one
  // that reads such a view, or one that reads a recreated table or virtual
  // table (the recreate drops and puts back the views that read it). Fill it
  // again once every view exists. A view the migration leaves alone exists
  // all along, so the fill at creation is enough.
  const recreatedNames = new Set(
    [
      ...tableRecreates.map((r) => r.target.name),
      ...recreates.flatMap((r) => [r.current.name, r.target.name]),
    ].map(foldName),
  );
  for (const { target } of [...creates, ...recreates]) {
    const { handler, args } = resolveVirtualTable(target);
    if (!handler.rebuild) continue;
    const reasons = handler.dependencies(target, args).flatMap((dependency): RecreateReason[] => {
      const view = findByName(diff.desired.views, dependency);
      if (!view) return [];
      const changed = changedViewInChain(view, diff, () => true);
      const recreatedTable = viewBaseTables(view, diff.desired.views).find(
        (table) => foldName(table) !== foldName(target.name) && recreatedNames.has(foldName(table)),
      );
      if (!changed && !recreatedTable) return [];
      const why = changed
        ? `view "${changed.view.name}" is ${changed.change} after it`
        : `table "${recreatedTable}" below it is recreated after it`;
      return [
        {
          check: "virtual_table.dependency_view",
          detail: `Virtual table "${target.name}" reads from view "${view.name}", which is created after it (${why})`,
        },
      ];
    });
    if (reasons.length === 0) continue;
    rebuilds.push({ type: "rebuild", target, reasons });
  }

  return { drops, renames, creates, recreates, rebuilds, ignore, kept };
}

/**
 * The view and the views it reads, following views that read other views
 */
function viewChain(view: View, views: View[], seen = new Set<string>()): View[] {
  seen.add(foldName(view.name));
  const nested = views
    .filter((other) => !seen.has(foldName(other.name)))
    .filter((other) => findViewsDependingOnTable(other, [view]).length > 0)
    .flatMap((other) => viewChain(other, views, seen));
  return [view, ...nested];
}

/**
 * The tables (and virtual tables) a view reads, following views that read
 * other views
 */
function viewBaseTables(view: View, views: View[]): string[] {
  return viewChain(view, views).flatMap((v) => v.tables);
}

/**
 * The view in the chain a view reads through (see viewChain) that this
 * migration creates or whose SQL it changes, and how
 */
function changedViewInChain(
  view: View,
  diff: SchemaDiff,
  redefined: (m: SchemaDiff["view"]["modified"][number]) => boolean,
): { view: View; change: "created" | "redefined" } | undefined {
  for (const v of viewChain(view, diff.desired.views)) {
    const same = (name: string) => foldName(name) === foldName(v.name);
    if (diff.view.added.some((a) => same(a.name))) return { view: v, change: "created" };
    if (diff.view.modified.some((m) => same(m.desired.name) && redefined(m))) {
      return { view: v, change: "redefined" };
    }
  }
  return undefined;
}

// Pair a removed and an added virtual table as a rename when the module
// supports it and the definitions are equivalent apart from the name
function getVirtualTableRenames(diff: SchemaDiff) {
  const renames = new Array<RenameOperation<VirtualTable>>();
  const matchedAdded = new Set<VirtualTable>();
  const matchedRemoved = new Set<VirtualTable>();

  for (const removed of diff.virtual_table.removed) {
    for (const added of diff.virtual_table.added) {
      if (matchedAdded.has(added)) continue;
      if (!sameModule(removed, added)) continue;
      const handler = getVirtualTableModule(added.module);
      if (!handler.supportsRename) continue;
      if (handler.canRename && !handler.canRename(removed, handler.parseArgs(removed.args))) {
        continue;
      }
      if (virtualTableDifferences(removed, added).length > 0) continue;

      renames.push({ type: "rename", current: removed, target: added });
      matchedAdded.add(added);
      matchedRemoved.add(removed);
      break;
    }
  }

  return {
    creates: diff.virtual_table.added
      .filter((vt) => !matchedAdded.has(vt))
      .map((target): CreateOperation<VirtualTable> => ({ type: "create", target })),
    drops: diff.virtual_table.removed
      .filter((vt) => !matchedRemoved.has(vt))
      .map((current): DropOperation<VirtualTable> => ({ type: "drop", current })),
    renames,
  };
}

// Ask the module handler how a virtual table reacts to its dependencies being
// recreated or renamed in this migration. The strongest reaction wins.
//
// A dependency that is created, redefined or replaced by another kind of
// object under the same name (a view by a table, a table by a view, a renamed
// table by a view that takes its old name) holds different rows afterwards,
// so it counts as recreated too.
function getDependencyReaction(
  target: VirtualTable,
  tableRecreates: RecreateOperation[],
  tableRenames: RenameOperation<Table>[],
  diff: SchemaDiff,
): { type: "rebuild" | "recreate"; reasons: RecreateReason[] } | null {
  const { handler, args } = resolveVirtualTable(target);
  if (!handler.onDependencyChanged) return null;

  const desired = diff.desired;
  const same = (a: string, b: string) => foldName(a) === foldName(b);
  let type: DependencyReaction = "none";
  const reasons = new Array<RecreateReason>();

  for (const dependency of handler.dependencies(target, args)) {
    let change: "recreated" | "renamed" | null = null;
    let detail = "";

    const view = findByName(desired.views, dependency);
    // The view itself, or a view it reads through
    const changed = view && changedViewInChain(view, diff, (m) => m.changes.includes("sql"));
    if (view && changed) {
      // The rows the index was built from are not the rows the view returns
      change = "recreated";
      detail = same(changed.view.name, view.name)
        ? `View "${view.name}" read by virtual table "${target.name}" is ${changed.change}`
        : `View "${changed.view.name}" read by virtual table "${target.name}" through view "${view.name}" is ${changed.change}`;
    } else if (view) {
      // A view is read under its own name, which a rename of a table below it
      // does not change (ALTER TABLE ... RENAME rewrites the view). A table
      // recreated below it may renumber the rowids the view exposes.
      const recreatedTable = viewBaseTables(view, desired.views).find((table) =>
        tableRecreates.some((r) => same(r.target.name, table)),
      );
      if (recreatedTable) {
        change = "recreated";
        detail = `Table "${recreatedTable}" read by virtual table "${target.name}" through view "${view.name}" is recreated`;
      }
    } else if (tableRecreates.some((r) => same(r.target.name, dependency))) {
      change = "recreated";
    } else if (
      tableRenames.some((r) => same(r.current.name, dependency) || same(r.target.name, dependency))
    ) {
      change = "renamed";
    } else if (diff.table.added.some((t) => same(t.name, dependency))) {
      change = "recreated";
      detail = `Table "${dependency}" read by virtual table "${target.name}" is created`;
    }
    if (!change) continue;

    const reaction = handler.onDependencyChanged({ target, args, dependency, change });
    if (reaction === "none") continue;

    reasons.push({
      check: `virtual_table.dependency_${change}`,
      detail: detail || `Table "${dependency}" read by virtual table "${target.name}" is ${change}`,
    });
    // A handler that cannot rebuild falls back to a recreate
    if (reaction === "recreate" || !handler.rebuild) {
      type = "recreate";
    } else if (type === "none") {
      type = "rebuild";
    }
  }

  return type === "none" ? null : { type, reasons };
}

export type MigrationPlan = MigrationOperation[];
