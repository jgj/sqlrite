# Architecture

SQLRite follows a pipeline architecture for declarative schema migration:

```
User DDL → Introspect → Compare → Plan → Generate DDL → Execute
```

## Pipeline Stages

### 1. Introspection (`src/introspect.ts`)

Extracts the complete schema state from a SQLite database as structured data. Uses a single SQL query that combines:

- `sqlite_schema` for table/view/trigger/index SQL definitions
- `pragma_table_info()` for column details (type, nullable, default, pk)
- `pragma_index_list()` + `pragma_index_info()` for index details
- `pragma_foreign_key_list()` for foreign key relationships

Post-processing parses CHECK constraints, AUTOINCREMENT, and generated columns from the raw CREATE TABLE SQL, since SQLite's pragmas don't expose these directly.

### 2. Comparison (`src/compare/`)

Compares two `IntrospectionResult` objects (current vs desired) and produces a `SchemaDiff`. Each schema object type gets its own diff:

- **Tables**: Compared by normalized SQL (handles quoting/whitespace differences from ALTER TABLE)
- **Columns**: Compared by `{table}.{column}` key, tracking which specific fields changed
- **Indexes**: Compared by name
- **Foreign Keys**: Compared by generated name (`fk_{table}_{col}_{ref_table}_{ref_col}`)
- **Primary Keys**: Compared by table name
- **Triggers/Views**: Compared by name

### 3. Migration Planning (`src/migration-plan.ts`)

Determines the minimal set of operations needed. SQLite only supports four ALTER TABLE operations:

- `RENAME TABLE`
- `RENAME COLUMN`
- `ADD COLUMN`
- `DROP COLUMN` (3.35.0+, with restrictions)

Everything else requires **table recreation**: create temp table → copy data → drop old → rename temp.

The planner detects table renames (via SQL comparison minus name) and column renames (via heuristic matching of removed+added columns with compatible types).

### 4. DDL Generation (`src/generate-ddl.ts`)

Converts the migration plan into executable SQL statements. The table recreation flow follows SQLite's recommended procedure:

1. `CREATE TABLE temp_{name} (...)` with the new schema
2. `INSERT INTO temp_{name} SELECT ... FROM {name}` (common columns only)
3. `DROP TABLE {name}`
4. `ALTER TABLE temp_{name} RENAME TO {name}`

### 5. Execution (`src/migrate.ts` + `src/driver.ts`)

Executes the generated DDL within a transaction. The driver abstraction supports both `better-sqlite3` and `@libsql/client`.

## Key Design Decisions

- **Introspection-based comparison**: Instead of tracking migration history, we compare the current database state against the desired state. This makes migrations truly declarative — the desired schema is the single source of truth.
- **SQL normalization**: SQLite stores CREATE TABLE SQL differently depending on how the table was created/modified. The comparison layer normalizes SQL to avoid false diffs from quoting and whitespace differences.
- **Conservative recreation**: When in doubt about whether an ALTER TABLE can handle a change, we fall back to table recreation. This is slower but always correct.
