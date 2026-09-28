# TODO

## Phase 1: Migration Engine

### High Priority
- [x] Enable better-sqlite3 driver testing
- [x] Column rename during table recreation (map old→new names in INSERT...SELECT)
- [x] Recreate indexes after table recreation
- [x] Recreate triggers and views after table recreation
- [x] Handle generated columns in INSERT...SELECT (virtual columns excluded)
- [x] Handle modified views/triggers/indexes (drop+create)
- [x] Detect NOT NULL columns without default requiring recreation
- [x] Normalize SQL comparison across all object types (tables, indexes, views, triggers)
- [x] Handle expression indexes in introspection
- [x] Virtual table layer (opt-in `manageVirtualTables`): per-module handler registry, default DROP + CREATE handler, shadow tables detected via `pragma_table_list`, `prepareNextDatabase` hook for extension modules
- [x] FTS5 handler: equivalence of option spellings, data-preserving recreates, external-content rebuilds
- [x] Add node:sqlite (DatabaseSync) as third supported driver

### Medium Priority
- [x] Multi-column foreign key introspection (group `pragma_foreign_key_list` by id)
- [x] Use `pragma_table_xinfo` for generated column detection
- [x] Foreign key safety: verified PRAGMA foreign_keys handling across all 3 drivers
- [x] Dry-run mode (`dryRun` export)
- [x] Better error messages with MigrationError context (statement index + SQL)

### Low Priority
- [ ] Performance with large schemas (hundreds of tables)
- [ ] ATTACH database / multi-schema support
- [ ] TEMPORARY table handling
- [ ] Column rename detection disambiguation (handle identical types)
- [ ] Rollback/undo support

## Phase 2: Type-Safe Schema Definition
- [ ] Type-safe schema definition DSL
- [ ] Generate DDL from schema definitions
- [ ] Infer TypeScript types from schema definitions
- [ ] Integration with migration engine (define desired schema in code, not SQL strings)

## Phase 3: Query Builder
- [ ] Query builder with type inference from schema definitions
- [ ] Migration history tracking (optional)

## Phase 4: CLI
- [ ] CLI tool for running migrations
- [ ] Schema diffing from command line
- [ ] Migration plan preview (dry-run)
