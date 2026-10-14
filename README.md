# sqlrite

Declarative schema management for SQLite.

You write the schema you want as `CREATE` statements. sqlrite compares it with the schema of a
live database and generates and runs the SQL that turns one into the other. There are no
migration files and no migration history: the desired schema is the single source of truth.

sqlrite builds your desired schema in a scratch in-memory database of the same driver, so SQLite
itself parses and validates it, and both schemas are read back the same way before they are
compared.

## Install

```sh
pnpm add sqlrite
```

sqlrite needs Node.js 22 or later and one of the supported drivers:

| Driver                                                              | Client type    | Install                   |
| ------------------------------------------------------------------- | -------------- | ------------------------- |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)        | `Database`     | `pnpm add better-sqlite3` |
| [node:sqlite](https://nodejs.org/api/sqlite.html)                   | `DatabaseSync` | built in                  |
| [@libsql/client](https://github.com/tursodatabase/libsql-client-ts) | `Client`       | `pnpm add @libsql/client` |

## Usage

```typescript
import Database from "better-sqlite3";
import { migrate } from "sqlrite";

const schema = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX users_created_at ON users (created_at);
`;

const db = new Database("app.db");
const result = await migrate(db, schema);

if (!result.success) throw result.err;
console.log(result.statements); // the SQL that was run
console.log(result.warnings); // see "Warnings" below
```

Running `migrate` again with the same schema runs nothing.

sqlrite manages tables, columns, indexes, views, triggers and foreign keys, and virtual tables
when you opt in (see `manageVirtualTables`). The schema string is your whole schema: an object in
the database that it does not declare is dropped.

## Look before you migrate

`migrate` runs the statements it generates even when they lose data. To see them first, use
`getMigrationPreview`, or `getMigration` for the statements alone:

```typescript
import { getMigration, getMigrationPreview, migrate } from "sqlrite";

const statements = await getMigration(db, schema); // string[]

const { warnings } = await getMigrationPreview(db, schema);
if (warnings.some((w) => w.type === "destructive")) {
  throw new Error(warnings.map((w) => w.message).join("\n"));
}
await migrate(db, schema);
```

### Warnings

| `type`            | Meaning                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `destructive`     | Data will be lost: a table or column is dropped, for instance.              |
| `caution`         | Data is kept, but the change is heavy: a table is recreated, for instance.  |
| `possible_rename` | A dropped and an added column of one table look alike. See `renameColumns`. |

A `possible_rename` warning also has `table`, `from` and `to`.

## Table recreation

SQLite's `ALTER TABLE` can only rename a table, and add, drop or rename a column. sqlrite uses it
for those changes. Any other change to a table (a column's type, nullability or default, a
constraint, column order, ...) recreates the table, as
[the SQLite documentation describes](https://www.sqlite.org/lang_altertable.html#otheralter): a
new table is created, the rows are copied into it, the old table is dropped and the new one takes
its name. Indexes, triggers and views on the table are created again.

A recreate keeps the data of every column the desired table still has, but it rewrites the whole
table, which takes time on a large one.

### Why is this table recreated?

Each recreate in the plan says which checks caused it:

```typescript
const { plan } = await getMigrationPreview(db, schema);

for (const op of plan) {
  if (op.type === "recreate") {
    console.log(`Recreating "${op.current.name}":`);
    for (const r of op.reasons ?? []) {
      console.log(`  [${r.check}] ${r.detail}`);
    }
  }
}
```

`check` identifies the check (`column.modified.data_type`, `column.order_changed`,
`foreign_key.added`, `table.sql_diff`, ...) and `detail` gives the values before and after. The
raw schema comparison is on the preview's `diff`.

## Options

`migrate`, `getMigrationPreview` and `getMigration` take an options object as their third
argument. Pass the same options to all of them.

### `renameColumns`

sqlrite never guesses column renames. A column the desired schema drops is dropped with its data,
and a column it adds starts empty. To keep the data, declare the rename, by table and then by
current column name:

```typescript
await migrate(db, schema, { renameColumns: { users: { username: "name" } } });
```

A rename that has already been made is skipped, so you can keep passing the same option after
the migration has run. Any other rename must be from a column the desired schema drops to a
column it adds to the same table, or it throws.

Table renames need no option: a table that disappears while another with the same definition
appears is renamed.

### `ignoreTableDeletion`

Tables missing from the desired schema are kept, with their indexes, triggers and views. Use it
when some tables of the database are deliberately not in your schema.

### `ignoreColumnOrder`

A difference in column order alone does not recreate the table. Other changes to the table still
do. Use it when a database's column order has drifted from your schema and you do not want to
rewrite the table for that.

### `manageVirtualTables`

When true, virtual tables (`CREATE VIRTUAL TABLE`) are created, dropped and recreated to match
the desired schema. When false (the default), they are left exactly as they are.

FTS5 tables have a dedicated handler: equivalent spellings of the same definition are not
changes, a rename uses `ALTER TABLE ... RENAME`, and a recreate keeps the rows of a table that
stores its own content, or rebuilds an external-content index from its content table. Virtual
tables of other modules are recreated with `DROP` and `CREATE`, which loses their data, and a
`destructive` warning says so.

### `prepareNextDatabase`

Called with the scratch database before the desired schema runs on it, so you can load the
extensions it needs. Without them, `CREATE VIRTUAL TABLE` fails with "no such module". The
scratch database has the type of the client you passed:

```typescript
await migrate(db, schema, {
  manageVirtualTables: true,
  prepareNextDatabase: (scratch) => {
    scratch.loadExtension("/path/to/vec0");
  },
});
```

Loading extensions on your own database is up to you. When you pass this hook, node:sqlite opens
the scratch database with `allowExtension: true`. A libsql client has no API to load extensions.

## Drizzle

If you define your schema with [Drizzle](https://orm.drizzle.team), `fromDrizzle` turns its
tables into the `CREATE TABLE` and `CREATE INDEX` statements sqlrite takes:

```typescript
import { migrate } from "sqlrite";
import { fromDrizzle } from "sqlrite/drizzle";
import { posts, users } from "./schema";

await migrate(db, fromDrizzle(users, posts));
```

It needs `drizzle-orm` 0.45.

## Errors

- A desired schema that SQLite rejects, or an invalid option, makes `migrate`,
  `getMigrationPreview` and `getMigration` throw.
- A migration whose statements fail is rolled back, and `migrate` returns `success: false` with
  the error as `err`. When sqlrite can tell which statement failed, `err` is a `MigrationError`:

```typescript
import { MigrationError, migrate } from "sqlrite";

const result = await migrate(db, schema);
if (result.err instanceof MigrationError) {
  console.error(result.err.statementIndex, result.err.statement, result.err.cause);
}
```

- A migration that would change a temp table, view, index or trigger of the connection instead
  of the object of the same name in the main schema is refused: `migrate` returns
  `success: false`.

## Before you use it on a database you care about

Back it up. Preview the migration and read the warnings before you run it, at least until you
trust what sqlrite does with your schema.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
