import type {
  Column,
  Index,
  IntrospectionResult,
  Table,
  Trigger,
  View,
} from "./introspection-result";
import type { MigrationPlan } from "./migration-plan";
import { columnsLookLikeRename, isTesting, sqlIdentifier as sql } from "./utils";

export type DDLStatement = string;

export function generateDDL(
  plan: MigrationPlan,
  curr: IntrospectionResult,
  next: IntrospectionResult,
): DDLStatement[] {
  const statements: DDLStatement[] = [];

  // Create column lookup tables for efficiency
  const currentColumnsByTable = groupColumnsByTable(curr.columns);
  const targetColumnsByTable = groupColumnsByTable(next.columns);

  // Process each operation in the plan
  for (const operation of plan) {
    try {
      switch (operation.type) {
        case "create":
          if (operation.target.type === "table") {
            statements.push(generateCreateTableDDL(operation.target));
          } else if (operation.target.type === "column") {
            statements.push(generateAddColumnDDL(operation.target));
          } else if (operation.target.type === "index") {
            statements.push(generateCreateIndexDDL(operation.target));
          } else if (operation.target.type === "trigger") {
            statements.push(generateCreateTriggerDDL(operation.target));
          } else if (operation.target.type === "view") {
            statements.push(generateCreateViewDDL(operation.target));
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
            statements.push(generateDropViewDDL(operation.current));
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
            const targetViews = next.views.filter((v) => v.tables.includes(tableName));
            statements.push(
              ...generateRecreateTableDDL(
                operation.current,
                operation.target,
                currentColumnsByTable[operation.current.name] || [],
                targetColumnsByTable[operation.target.name] || [],
                targetIndexes,
                targetTriggers,
                targetViews,
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

  return statements;
}

// Helper to group columns by table for faster lookup
function groupColumnsByTable(columns: Column[]): Record<string, Column[]> {
  return columns.reduce<Record<string, Column[]>>((acc, column) => {
    if (!acc[column.table]) {
      acc[column.table] = [];
    }
    acc[column.table].push(column);
    return acc;
  }, {});
}

// Helper to ensure SQL statements end with a semicolon
function ensureSemicolon(sql: string): string {
  if (!sql) return "";
  return sql.trim().endsWith(";") ? sql : `${sql};`;
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
  targetIndexes: Index[] = [],
  targetTriggers: Trigger[] = [],
  targetViews: View[] = [],
): DDLStatement[] {
  const statements: DDLStatement[] = [];
  const safeName = targetTable.name.replace(/[^a-zA-Z0-9_]/g, "_");
  const tempTableName = `temp_${safeName}`;

  // Drop dependent views and triggers first (they reference the table by name)
  for (const view of targetViews) {
    statements.push(generateDropViewDDL(view));
  }
  for (const trigger of targetTriggers) {
    statements.push(generateDropTriggerDDL(trigger));
  }

  // Create temporary table with new schema
  const createTempTableSQL = targetTable.sql.replace(
    new RegExp(`"?${targetTable.name}"?`),
    sql(tempTableName),
  );
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

  // Recreate dependent objects that were dropped with the old table
  for (const index of targetIndexes) {
    statements.push(generateCreateIndexDDL(index));
  }
  for (const trigger of targetTriggers) {
    statements.push(generateCreateTriggerDDL(trigger));
  }
  for (const view of targetViews) {
    statements.push(generateCreateViewDDL(view));
  }

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
      for (let i = 0; i < unmatchedCurrent.length; i++) {
        if (matchedCurrentIdxs.has(i)) continue;
        if (columnsLookLikeRename(unmatchedCurrent[i], targetCol, true)) {
          mapping.push({ source: unmatchedCurrent[i].name, target: targetCol.name });
          matchedCurrentIdxs.add(i);
          break;
        }
      }
    }

    // Relaxed pass for remaining unmatched
    for (const targetCol of unmatchedTarget) {
      if (mapping.some((m) => m.target === targetCol.name)) continue;
      for (let i = 0; i < unmatchedCurrent.length; i++) {
        if (matchedCurrentIdxs.has(i)) continue;
        if (columnsLookLikeRename(unmatchedCurrent[i], targetCol, false)) {
          mapping.push({ source: unmatchedCurrent[i].name, target: targetCol.name });
          matchedCurrentIdxs.add(i);
          break;
        }
      }
    }
  }

  return mapping;
}

// Helper to properly quote SQL strings
function sqlString(sql: string): string {
  return `'${sql.replace(/'/g, "''")}'`;
}
