import type { MigrationPlan } from "./migration-plan";
import type {
  Table,
  Column,
  Index,
  Trigger,
  View,
  IntrospectionResult,
} from "./introspection-result";
import { sqlIdentifier as sql } from "./utils";

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
            statements.push(
              ...generateRecreateTableDDL(
                operation.current,
                operation.target,
                currentColumnsByTable[operation.current.name] || [],
                targetColumnsByTable[operation.target.name] || [],
              ),
            );
          }
          break;

        case "rewrite":
          if (operation.current.type === "table" && operation.target.type === "table") {
            statements.push(...generateRewriteTableDDL(operation.target));
          }
          break;
      }
    } catch (error) {
      console.error("Error generating DDL for operation:", operation, error);
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
): DDLStatement[] {
  const statements: DDLStatement[] = [];
  const safeName = targetTable.name.replace(/[^a-zA-Z0-9_]/g, "_");
  const tempTableName = `temp_${safeName}`;

  // Create temporary table with new schema
  const createTempTableSQL = targetTable.sql.replace(
    new RegExp(`"?${targetTable.name}"?`),
    sql(tempTableName),
  );
  statements.push(ensureSemicolon(createTempTableSQL));

  // Get common columns between current and target tables
  const commonColumnNames = currentColumns
    .map((col) => col.name)
    .filter((name) => targetColumns.some((targetCol) => targetCol.name === name));

  // Copy data from old table to new table
  if (commonColumnNames.length > 0) {
    const columnList = commonColumnNames.map((name) => sql(name)).join(", ");
    statements.push(
      `INSERT INTO ${sql(tempTableName)} (${columnList}) SELECT ${columnList} FROM ${sql(currentTable.name)};`,
    );
  }

  // Drop old table
  statements.push(`DROP TABLE ${sql(currentTable.name)};`);

  // Rename temporary table to target name
  statements.push(`ALTER TABLE ${sql(tempTableName)} RENAME TO ${sql(targetTable.name)};`);

  return statements;
}

// Generate DDL for table schema rewrite
function generateRewriteTableDDL(targetTable: Table): DDLStatement[] {
  const statements: DDLStatement[] = [];

  // Only alter constraints/defaults that don't affect storage format
  statements.push("BEGIN TRANSACTION;");
  statements.push("PRAGMA schema_version;"); // Get current schema version
  statements.push("PRAGMA writable_schema=ON;");

  // Update the table definition
  statements.push(
    `UPDATE sqlite_schema SET sql = ${sqlString(targetTable.sql)} WHERE type = 'table' AND name = ${sqlString(targetTable.name)};`,
  );

  // Increment schema version (actual version will be determined at runtime)
  statements.push(
    "PRAGMA schema_version = (SELECT max(schema_version) + 1 FROM pragma_schema_version);",
  );
  statements.push("PRAGMA writable_schema=OFF;");
  statements.push("PRAGMA integrity_check;");
  statements.push("COMMIT;");

  return statements;
}

// Helper to properly quote SQL strings
function sqlString(sql: string): string {
  return `'${sql.replace(/'/g, "''")}'`;
}
