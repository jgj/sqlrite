import type { SchemaDiff } from "./compare/types";
import type { Column, Index, Table, Trigger, View } from "./introspection-result";
import type {
  CreateOperation,
  DropOperation,
  MigrationOperation,
  RecreateOperation,
  RecreateReason,
  RenameOperation,
} from "./migration-operation";
import type { MigrationOptions } from "./migration-statements";
import { columnsLookLikeRename, invariant } from "./utils";

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
  const ignore = new Set(tableRecreates.map((t) => t.target.name));

  // ignoreTableDeletion: suppress drop operations and treat these tables as
  // ignored so dependent indexes/triggers/views aren't dropped either. This
  // runs after the rename heuristic, so drop+create pairs still resolve to
  // renames as usual — only true deletions are suppressed.
  if (options.ignoreTableDeletion) {
    for (const drop of tableDrops) {
      ignore.add(drop.current.name);
    }
    tableDrops = [];
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
  const viewDrops = getViewDrops(diff, ignore);
  const viewCreates = getViewCreates(diff, ignore);

  return [
    ...viewDrops, // Drop views first since they may depend on tables
    ...triggerDrops, // Drop triggers before modifying tables they rely on
    ...indexDrops, // Drop indexes before modifying their tables

    ...tableRecreates, // Recreate tables (involves dropping and recreating)
    ...tableRenames, // Rename tables
    ...tableDrops, // Drop tables that aren't being recreated
    ...tableCreates, // Create new tables

    ...columnRenames, // Rename columns
    ...columnDrops, // Drop columns
    ...columnAdds, // Add columns

    ...indexCreates, // Recreate indexes
    ...triggerCreates, // Recreate triggers
    ...viewCreates, // Recreate views
  ];
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

function getViewDrops(diff: SchemaDiff, tablesToIgnore: Set<string>): DropOperation<View>[] {
  const removed = diff.view.removed.filter(
    (view) => !view.tables.some((table) => tablesToIgnore.has(table)),
  );
  const modified = diff.view.modified
    .filter(({ current }) => !current.tables.some((table) => tablesToIgnore.has(table)))
    .map(({ current }) => current);

  return [...removed, ...modified].map((view) => ({
    type: "drop",
    current: view,
  }));
}

function getViewCreates(diff: SchemaDiff, tablesToIgnore: Set<string>): CreateOperation<View>[] {
  const added = diff.view.added.filter(
    (view) => !view.tables.some((table) => tablesToIgnore.has(table)),
  );
  const modified = diff.view.modified
    .filter(({ desired }) => !desired.tables.some((table) => tablesToIgnore.has(table)))
    .map(({ desired }) => desired);

  return [...added, ...modified].map((view) => ({
    type: "create",
    target: view,
  }));
}

export type MigrationPlan = MigrationOperation[];
