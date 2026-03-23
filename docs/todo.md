# TODO

## Phase 1: Migration Engine

### High Priority
- [ ] Enable better-sqlite3 driver testing (currently commented out in integration tests)
- [ ] Column rename during table recreation (map old→new names in INSERT...SELECT)
- [ ] Recreate indexes/triggers after table recreation (currently lost)
- [ ] Handle generated columns in INSERT...SELECT (virtual columns can't be inserted into)
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

## Phase 2: Query Builder / ORM Layer
- [ ] Type-safe schema definition DSL
- [ ] Query builder with type inference
- [ ] Migration history tracking (optional)
- [ ] CLI tool for running migrations
