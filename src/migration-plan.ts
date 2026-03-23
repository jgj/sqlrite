import type { SchemaDiff } from "./compare/types";
import type { Column, Index, Table, Trigger, View } from "./introspection-result";
import type {
  CreateOperation,
  DropOperation,
  MigrationOperation,
  RecreateOperation,
  RenameOperation,
} from "./migration-operation";
import { columnsLookLikeRename, invariant } from "./utils";

export function createMigrationPlan(diff: SchemaDiff): MigrationPlan {
  /*
    The only schema altering commands directly supported by SQLite are:
      - "rename table"
      - "rename column"
      - "add column"
      - "drop column"

    For all other schema changes, we need to recreate the table.
  */

  const [tableCreates, tableDrops, tableRenames] = getTableRenames(diff);

  // Get all tables that need to be recreated
  const tableRecreates = getTableRecreates(diff);
  const ignore = new Set(tableRecreates.map((t) => t.target.name));

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

function getTableRecreates(diff: SchemaDiff): RecreateOperation[] {
  const result = new Array<RecreateOperation>();
  const tablesRequiringRecreation = new Set<string>();

  // Get mapping of table name to modified table objects
  const modifiedTables = new Map(
    diff.table.modified.map(({ current, desired }) => [current.name, { current, desired }]),
  );

  // Check for column changes that require table recreation
  checkColumnsForRecreation(diff, tablesRequiringRecreation);

  // Check for primary key changes that require table recreation
  checkPrimaryKeysForRecreation(diff, tablesRequiringRecreation);

  // Check for foreign key changes that require table recreation
  checkForeignKeysForRecreation(diff, tablesRequiringRecreation);

  // Check for index changes that might require table recreation
  checkIndicesForRecreation(diff, tablesRequiringRecreation);

  // Check for tables that would have previously been rewritten
  checkTablesForConstraintChanges(diff, tablesRequiringRecreation);

  // Generate RecreateOperations for identified tables
  for (const tableName of tablesRequiringRecreation) {
    const modifiedTable = modifiedTables.get(tableName);
    if (modifiedTable) {
      result.push({
        type: "recreate",
        current: modifiedTable.current,
        target: modifiedTable.desired,
      });
    }
  }

  return result;
}

function checkColumnsForRecreation(diff: SchemaDiff, tablesRequiringRecreation: Set<string>): void {
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

  // Handle dropped columns - only require recreation if the column is not at the end
  for (const column of diff.column.removed) {
    const table = diff.current.tables.find((t) => t.name === column.table);
    invariant(
      table,
      `Table '${column.table}' for column '${column.name}' is not in current schema`,
    );
    if (column.ordinal_position + 1 < table.num_cols) {
      tablesRequiringRecreation.add(column.table);
    }
  }

  // Analyze column changes for each table
  for (const [tableName, { current, desired }] of columnsByTable.entries()) {
    // Check if column order has changed
    if (hasColumnOrderChanged(current, desired)) {
      tablesRequiringRecreation.add(tableName);
      continue;
    }

    // Check for data type changes, nullability changes, etc.
    for (const modification of diff.column.modified) {
      if (modification.current.table === tableName) {
        const { changes } = modification;

        // Data type changes require recreation
        if (changes.includes("data_type")) {
          tablesRequiringRecreation.add(tableName);
          break;
        }

        // Change from NULL to NOT NULL requires recreation
        // Change from NOT NULL to NULL is handled directly with ALTER TABLE
        if (
          changes.includes("nullable") &&
          modification.current.nullable &&
          !modification.desired.nullable
        ) {
          tablesRequiringRecreation.add(tableName);
          break;
        }

        // Precision or character length changes require recreation
        if (changes.includes("precision") || changes.includes("character_maximum_length")) {
          tablesRequiringRecreation.add(tableName);
          break;
        }

        // Check constraint changes require recreation
        if (changes.includes("check_constraint")) {
          tablesRequiringRecreation.add(tableName);
          break;
        }

        // AUTOINCREMENT changes require recreation
        if (changes.includes("autoincrement")) {
          tablesRequiringRecreation.add(tableName);
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

function checkPrimaryKeysForRecreation(
  diff: SchemaDiff,
  tablesRequiringRecreation: Set<string>,
): void {
  // Added primary keys require recreation
  for (const pk of diff.primary_key.added) {
    tablesRequiringRecreation.add(pk.table);
  }

  // Modified primary keys require recreation
  for (const { current } of diff.primary_key.modified) {
    tablesRequiringRecreation.add(current.table);
  }

  // Removed primary keys require recreation
  for (const pk of diff.primary_key.removed) {
    tablesRequiringRecreation.add(pk.table);
  }
}

function checkForeignKeysForRecreation(
  diff: SchemaDiff,
  tablesRequiringRecreation: Set<string>,
): void {
  // Adding foreign keys requires recreation
  for (const fk of diff.foreign_key.added) {
    tablesRequiringRecreation.add(fk.table);
  }

  // Check modified foreign keys
  for (const { current, changes } of diff.foreign_key.modified) {
    // If we're changing anything other than dropping constraints, we need recreation
    const nonRemovalChanges = changes.filter(
      (change) => change !== "on_update" && change !== "on_delete" && change !== "definition",
    );

    if (nonRemovalChanges.length > 0) {
      tablesRequiringRecreation.add(current.table);
    }
  }
}

function checkIndicesForRecreation(diff: SchemaDiff, tablesRequiringRecreation: Set<string>): void {
  // Adding unique indices requires recreation
  for (const index of diff.index.added) {
    if (index.unique) {
      tablesRequiringRecreation.add(index.table);
    }
  }

  // Check for modified indices where uniqueness has changed
  for (const { current, desired, changes } of diff.index.modified) {
    if (changes.includes("unique") && !current.unique && desired.unique) {
      tablesRequiringRecreation.add(current.table);
    }
  }
}

function checkTablesForConstraintChanges(
  diff: SchemaDiff,
  tablesRequiringRecreation: Set<string>,
): void {
  // Identify tables with DEFAULT value changes or NOT NULL constraint changes
  for (const { current, desired, changes } of diff.column.modified) {
    // Skip tables already marked for recreation
    if (tablesRequiringRecreation.has(current.table)) continue;

    // Default value changes require recreation
    if (changes.includes("default")) {
      tablesRequiringRecreation.add(current.table);
    }

    // NOT NULL constraint removal (NOT NULL → NULL) requires recreation
    // SQLite has no ALTER COLUMN — this can only be done via table recreation
    if (changes.includes("nullable") && !current.nullable && desired.nullable) {
      tablesRequiringRecreation.add(current.table);
    }
  }

  // Identify tables with FOREIGN KEY constraint removals
  for (const fk of diff.foreign_key.removed) {
    // Skip tables already marked for recreation
    if (tablesRequiringRecreation.has(fk.table)) continue;

    tablesRequiringRecreation.add(fk.table);
  }

  // Identify tables with FK on_update/on_delete changes (also requires recreation)
  for (const { current, changes } of diff.foreign_key.modified) {
    if (tablesRequiringRecreation.has(current.table)) continue;

    if (changes.includes("on_update") || changes.includes("on_delete")) {
      tablesRequiringRecreation.add(current.table);
    }
  }

  // Catch remaining constraint changes (table-level CHECK, etc.) by comparing SQL
  // but only for tables whose SQL difference is NOT already explained by
  // column adds, drops, or renames
  for (const { current, desired } of diff.table.modified) {
    if (tablesRequiringRecreation.has(current.name)) continue;
    if (current.sql === desired.sql) continue;

    // If this table has column adds, drops, or renames, those explain the SQL difference
    if (tableHasColumnStructureChanges(current.name, diff)) continue;

    // Remaining SQL differences are constraint-level changes requiring recreation
    tablesRequiringRecreation.add(current.name);
  }
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

    // Track which columns have been matched to avoid double-matching
    const matchedAdded = new Set<number>();
    const matchedRemoved = new Set<number>();

    // First pass: look for highly similar columns (strong matches)
    for (let i = 0; i < removed.length; i++) {
      if (matchedRemoved.has(i)) continue;

      for (let j = 0; j < added.length; j++) {
        if (matchedAdded.has(j)) continue;

        if (columnsLookLikeRename(removed[i], added[j], true)) {
          result.push(createRenameOperation(removed[i], added[j]));
          matchedRemoved.add(i);
          matchedAdded.add(j);
          break;
        }
      }
    }

    // Second pass: look for columns that are similar but might have some differences
    for (let i = 0; i < removed.length; i++) {
      if (matchedRemoved.has(i)) continue;

      for (let j = 0; j < added.length; j++) {
        if (matchedAdded.has(j)) continue;

        if (columnsLookLikeRename(removed[i], added[j], false)) {
          result.push(createRenameOperation(removed[i], added[j]));
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
    if (!groups[column.table]) {
      groups[column.table] = [];
    }
    groups[column.table].push(column);
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
  return diff.index.removed
    .filter(
      (index) => !tablesToIgnore.has(index.table) && !index.name.startsWith("sqlite_autoindex"),
    )
    .map((index) => ({
      type: "drop",
      current: index,
    }));
}

function getIndexCreates(diff: SchemaDiff, tablesToIgnore: Set<string>): CreateOperation<Index>[] {
  return diff.index.added
    .filter(
      (index) => !tablesToIgnore.has(index.table) && !index.name.startsWith("sqlite_autoindex"),
    )
    .map((index) => ({
      type: "create",
      target: index,
    }));
}

function getTriggerDrops(diff: SchemaDiff, tablesToIgnore: Set<string>): DropOperation<Trigger>[] {
  return diff.trigger.removed
    .filter((trigger) => !tablesToIgnore.has(trigger.table))
    .map((trigger) => ({
      type: "drop",
      current: trigger,
    }));
}

function getTriggerCreates(
  diff: SchemaDiff,
  tablesToIgnore: Set<string>,
): CreateOperation<Trigger>[] {
  return diff.trigger.added
    .filter((trigger) => !tablesToIgnore.has(trigger.table))
    .map((trigger) => ({
      type: "create",
      target: trigger,
    }));
}

function getViewDrops(diff: SchemaDiff, tablesToIgnore: Set<string>): DropOperation<View>[] {
  return diff.view.removed
    .filter((view) => !view.tables.some((table) => tablesToIgnore.has(table)))
    .map((view) => ({
      type: "drop",
      current: view,
    }));
}

function getViewCreates(diff: SchemaDiff, tablesToIgnore: Set<string>): CreateOperation<View>[] {
  return diff.view.added
    .filter((view) => !view.tables.some((table) => tablesToIgnore.has(table)))
    .map((view) => ({
      type: "create",
      target: view,
    }));
}

export type MigrationPlan = MigrationOperation[];
