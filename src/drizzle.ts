import { SQL, StringChunk, is } from "drizzle-orm";
import { type SQLiteTableWithColumns, getTableConfig } from "drizzle-orm/sqlite-core";

/**
 * Structural shape of a Drizzle SQLite table. Typed duck-style rather than
 * as `SQLiteTable` because consumers commonly resolve a different physical
 * copy of `drizzle-orm` (separate peer-dep envs under pnpm produce distinct
 * nominal classes, and the `private shouldInlineParams` field on `SQL`
 * blocks structural assignment between them). The public `_` config is
 * stable across drizzle versions; runtime correctness relies on
 * `getTableConfig` rejecting non-tables.
 */
export type DrizzleSQLiteTable = {
  _: {
    name: string;
    schema: string | undefined;
    columns: Record<string, unknown>;
  };
};

/**
 * Generate SQL DDL from Drizzle table definitions.
 *
 * @param tables One or more Drizzle SQLite table definitions
 * @returns A string of CREATE TABLE and CREATE INDEX statements
 *
 * @example
 * ```typescript
 * import { users, posts } from "./schema";
 * import { fromDrizzle } from "sqlrite/drizzle";
 * import { migrate } from "sqlrite";
 *
 * const ddl = fromDrizzle(users, posts);
 * await migrate(db, ddl);
 * ```
 */
export function fromDrizzle(...tables: DrizzleSQLiteTable[]): string {
  const statements: string[] = [];

  for (const table of tables) {
    // biome-ignore lint/suspicious/noExplicitAny: bridge structural DrizzleSQLiteTable to our own drizzle copy's nominal type
    const config = getTableConfig(table as unknown as SQLiteTableWithColumns<any>);
    statements.push(generateCreateTable(config));

    for (const idx of config.indexes) {
      statements.push(generateCreateIndex(idx, config.name));
    }
  }

  return statements.join("\n\n");
}

type TableConfig = ReturnType<typeof getTableConfig>;
type ColumnConfig = TableConfig["columns"][number];
type IndexConfig = TableConfig["indexes"][number];
type ForeignKeyConfig = TableConfig["foreignKeys"][number];
type CheckConfig = TableConfig["checks"][number];
function generateCreateTable(config: TableConfig): string {
  const parts: string[] = [];

  // Column definitions
  for (const col of config.columns) {
    parts.push(`  ${generateColumnDef(col)}`);
  }

  // Composite primary keys
  for (const pk of config.primaryKeys) {
    const cols = pk.columns.map((c) => quoteId(c.name)).join(", ");
    parts.push(`  PRIMARY KEY (${cols})`);
  }

  // Foreign keys (inline references from column definitions)
  for (const fk of config.foreignKeys) {
    parts.push(`  ${generateForeignKey(fk)}`);
  }

  // Unique constraints (table-level)
  for (const uq of config.uniqueConstraints) {
    const cols = uq.columns.map((c) => quoteId(c.name)).join(", ");
    const name = uq.name ? `CONSTRAINT ${quoteId(uq.name)} ` : "";
    parts.push(`  ${name}UNIQUE (${cols})`);
  }

  // Check constraints
  for (const chk of config.checks) {
    parts.push(`  ${generateCheck(chk)}`);
  }

  return `CREATE TABLE ${quoteId(config.name)} (\n${parts.join(",\n")}\n);`;
}

function generateColumnDef(col: ColumnConfig): string {
  let def = `${quoteId(col.name)} ${col.getSQLType().toUpperCase()}`;

  // Inline PRIMARY KEY + AUTOINCREMENT
  if (col.primary) {
    def += " PRIMARY KEY";
    if ((col as unknown as Record<string, unknown>).autoIncrement) {
      def += " AUTOINCREMENT";
    }
  }

  // NOT NULL
  if (col.notNull && !col.primary) {
    def += " NOT NULL";
  }

  // DEFAULT
  if (col.default !== undefined) {
    def += ` DEFAULT ${serializeDefault(col.default)}`;
  }

  // UNIQUE (inline)
  if (col.isUnique) {
    def += " UNIQUE";
  }

  // GENERATED ALWAYS AS
  if (col.generated) {
    const expr = serializeSQL(col.generated.as as SQL);
    const mode = col.generated.mode === "stored" ? "STORED" : "VIRTUAL";
    def += ` GENERATED ALWAYS AS (${expr}) ${mode}`;
  }

  return def;
}

function generateForeignKey(fk: ForeignKeyConfig): string {
  const ref = fk.reference();
  const cols = ref.columns.map((c) => quoteId(c.name)).join(", ");
  const refTable = getTableConfig(ref.foreignTable).name;
  const refCols = ref.foreignColumns.map((c) => quoteId(c.name)).join(", ");

  let def = `FOREIGN KEY (${cols}) REFERENCES ${quoteId(refTable)}(${refCols})`;

  if (fk.onUpdate) {
    def += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
  }
  if (fk.onDelete) {
    def += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
  }

  return def;
}

function generateCheck(chk: CheckConfig): string {
  const expr = serializeSQL(chk.value);
  return `CONSTRAINT ${quoteId(chk.name)} CHECK (${expr})`;
}

function generateCreateIndex(idx: IndexConfig, tableName: string): string {
  const idxConfig = idx.config;
  const unique = idxConfig.unique ? "UNIQUE " : "";
  const cols = idxConfig.columns
    .map((c) => {
      if (is(c, SQL)) return serializeSQL(c);
      if ("name" in c && typeof c.name === "string") return quoteId(c.name);
      return String(c);
    })
    .join(", ");

  let stmt = `CREATE ${unique}INDEX ${quoteId(idxConfig.name)} ON ${quoteId(tableName)}(${cols})`;

  if (idxConfig.where) {
    stmt += ` WHERE ${serializeSQL(idxConfig.where)}`;
  }

  return `${stmt};`;
}

function serializeDefault(value: unknown): string {
  if (is(value, SQL)) {
    return serializeSQL(value);
  }
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (value === null) {
    return "NULL";
  }
  return String(value);
}

function serializeSQL(s: SQL): string {
  const chunks: string[] = [];
  for (const chunk of s.queryChunks) {
    if (is(chunk, StringChunk)) {
      chunks.push(chunk.value.join(""));
    } else if (is(chunk, SQL)) {
      chunks.push(serializeSQL(chunk));
    } else if (chunk && typeof chunk === "object" && "name" in chunk) {
      chunks.push(quoteId((chunk as { name: string }).name));
    } else {
      chunks.push(String(chunk));
    }
  }
  return chunks.join("");
}

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
