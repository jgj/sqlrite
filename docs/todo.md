# TODO

## Phase 1: Migration Engine

### High Priority
- [ ] Enable better-sqlite3 driver testing (currently commented out in integration tests)
- [ ] Column rename during table recreation (map old→new names in INSERT...SELECT)
- [x] Recreate indexes after table recreation
- [x] Recreate triggers and views after table recreation
- [x] Handle generated columns in INSERT...SELECT (virtual columns excluded)
- [x] Handle modified views/triggers/indexes (drop+create)
- [x] Detect NOT NULL columns without default requiring recreation
- [x] Normalize SQL comparison across all object types (tables, indexes, views, triggers)
- [x] Handle expression indexes in introspection
- [ ] Virtual table support (FTS5, R-Tree, etc.)

### Medium Priority
- [ ] Multi-column foreign key introspection (group `pragma_foreign_key_list` by id)
- [ ] Use `pragma_table_xinfo` for generated column detection (currently parsed from SQL)
- [ ] Foreign key safety: verify PRAGMA foreign_keys handling in both drivers
- [ ] Dry-run mode (generate DDL without executing)
- [ ] Better error messages with context about what operation failed

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
