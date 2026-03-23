# SQLite Edge Cases

Known edge cases encountered during development and how they're handled.

## ALTER TABLE ADD COLUMN Quoting

**Problem**: When SQLite stores the result of `ALTER TABLE ... ADD COLUMN "email" TEXT`, it quotes the identifier in the stored SQL: `CREATE TABLE users (..., "email" TEXT)`. A fresh `CREATE TABLE` with the same column stores it without quotes: `CREATE TABLE users (..., email TEXT)`.

**Impact**: Naive string comparison sees the schemas as different, triggering unnecessary table recreation on every migration.

**Solution**: `compare-tables.ts` normalizes SQL before comparison — removing unnecessary double quotes and normalizing whitespace/punctuation.

## ALTER TABLE ADD COLUMN Whitespace

**Problem**: SQLite appends added columns to the stored CREATE TABLE SQL with different whitespace/comma placement than the original DDL. For example: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL , "email" TEXT NOT NULL)` — note the space before the comma.

**Solution**: SQL normalization also normalizes comma spacing and paren spacing.

## Expression Indexes

**Problem**: `pragma_index_info()` returns `NULL` for the column name when the index uses an expression (e.g., `CREATE INDEX idx ON t(lower(col))`).

**Impact**: The arktype schema validation rejects null column names.

**Solution**: Use `COALESCE(ic.name, '__expr__' || ic.seqno)` in the introspection query to provide a placeholder for expression columns. The index SQL field (`index.sql`) is used for actual comparison.

## DROP COLUMN Position

**Problem**: SQLite's `ALTER TABLE DROP COLUMN` has restrictions — it may not work for columns referenced by indexes, triggers, or constraints. Even when it works, dropping a non-trailing column changes the ordinal positions of subsequent columns.

**Impact**: After dropping a non-trailing column via ALTER TABLE, the introspected schema shows different ordinal positions than the desired schema, causing a false diff.

**Solution**: Non-trailing column drops trigger table recreation instead of ALTER TABLE DROP COLUMN. This is conservative but guarantees correct ordinal positions.

## NOT NULL Constraint Removal

**Problem**: SQLite has no `ALTER TABLE ALTER COLUMN` — you cannot change a column's nullability without table recreation.

**Solution**: Removing NOT NULL (changing `nullable` from false to true) always triggers table recreation. Adding NOT NULL also requires recreation.

## Table Rename Detection

**Problem**: When the user renames a table, the diff sees it as "old table removed, new table added." Without rename detection, data would be lost.

**Solution**: The migration planner compares SQL definitions (minus the table name) between removed and added tables. If they match, it emits a `RENAME TABLE` instead of `DROP + CREATE`.

## Column Rename Detection

**Problem**: Similar to table renames — renaming a column appears as a column removed + column added.

**Solution**: Two-pass heuristic matching: strict mode (exact type/constraint match) then relaxed mode (compatible type families like TEXT/VARCHAR/CHAR). This can produce false positives for tables with identically-typed columns, but covers the common case well.
