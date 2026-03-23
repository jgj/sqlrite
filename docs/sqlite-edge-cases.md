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

## ADD COLUMN NOT NULL Without Default

**Problem**: SQLite's `ALTER TABLE ADD COLUMN` requires that NOT NULL columns have a default value. Without one, the operation fails because existing rows would have no value for the new column.

**Solution**: The migration planner detects added NOT NULL columns without a default and triggers table recreation instead of ALTER TABLE ADD COLUMN.

## Generated Columns in INSERT...SELECT

**Problem**: During table recreation, `INSERT INTO temp SELECT ... FROM old` copies data for common columns. But generated columns (STORED and VIRTUAL) are auto-computed and cannot be inserted into.

**Solution**: The DDL generator excludes generated columns from the INSERT...SELECT column list by checking the table SQL for `GENERATED ALWAYS AS` patterns.

## Index Loss During Table Recreation

**Problem**: The table recreation flow (create temp, copy, drop old, rename temp) drops all indexes on the original table. Indexes are not automatically transferred to the new table.

**Solution**: After table recreation, the DDL generator appends CREATE INDEX statements for all non-autoindex indexes that should exist on the target table.

## SQL Normalization Across Object Types

**Problem**: Views, triggers, and indexes may have cosmetic SQL differences (quoting, whitespace) between their stored form and the user's desired DDL. This causes false "modifications" that trigger unnecessary drop+create operations.

**Solution**: All SQL comparisons (tables, indexes, views, triggers) normalize SQL before comparing: removing unnecessary double quotes, collapsing whitespace, and normalizing punctuation.

## Generated Columns and pragma_table_xinfo

**Problem**: `pragma_table_info()` does not distinguish generated columns from regular columns. Regex-based detection from CREATE TABLE SQL is fragile.

**Solution**: Use `pragma_table_xinfo()` which provides a `hidden` field: 0=normal, 2=virtual generated, 3=stored generated. This is reliable and doesn't require SQL parsing.

**Gotcha**: When adding a generated column to an existing table, `ALTER TABLE ADD COLUMN` with `generateColumnDefinition()` doesn't include the `GENERATED ALWAYS AS` clause. Generated column additions always trigger table recreation.

## Multi-Column Foreign Keys

**Problem**: `pragma_foreign_key_list()` returns one row per column in a multi-column FK, all sharing the same `id`. The original code treated each row as a separate FK.

**Solution**: Group FK rows by `(table_name, fk.id)` using a SQL subquery with `group_concat()` to combine column names. This matches the primary key convention where composite key columns are comma-separated.
