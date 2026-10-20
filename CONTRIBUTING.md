# Contributing

## Setup

You need Node.js 22 or later and pnpm 10 (`corepack enable` picks up the version in
`package.json`).

```sh
pnpm install
```

`better-sqlite3` is a native module; pnpm is allowed to build it (see `pnpm-workspace.yaml`).

## Commands

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `pnpm run check`       | Lint and format with Biome, writing fixes |
| `pnpm run check:run`   | Lint and format check only                |
| `pnpm run typecheck`   | Type check (`tsc --noEmit`)               |
| `pnpm run test`        | Run all tests (Vitest)                    |
| `pnpm run test <file>` | Run one test file                         |
| `pnpm run test:watch`  | Run tests in watch mode                   |
| `pnpm run build`       | Build `dist/` with tsdown                 |

Before you send a change, `pnpm run check`, `pnpm run typecheck` and `pnpm run test` should pass.

## Layout

| Path                                    | What it holds                                                      |
| --------------------------------------- | ------------------------------------------------------------------ |
| `src/introspect.ts`                     | Reads a database's schema                                          |
| `src/compare-schema.ts`, `src/compare/` | Compares two schemas into a `SchemaDiff`                           |
| `src/migration-plan.ts`                 | Turns a diff into operations (create, drop, rename, recreate, ...) |
| `src/generate-ddl.ts`                   | Turns operations into SQL statements                               |
| `src/migration-statements.ts`           | Preview: runs the steps above, and makes the warnings              |
| `src/migrate.ts`, `src/driver.ts`       | Runs the statements on each driver                                 |
| `src/virtual-tables/`                   | Virtual table handlers (FTS5, and a default)                       |
| `src/drizzle.ts`                        | `@jdctech/sqlrite/drizzle`: DDL from Drizzle tables                |
| `docs/`                                 | Architecture and the SQLite edge cases handled                     |

## Tests

Unit tests sit next to the code they test (`src/**/*.test.ts`). Tests that run whole
migrations are in `test/`.

### Integration test cases

`test/integration.test.ts` runs every module in `test/test-cases/` on all three drivers. A case
is a starting schema and a desired one:

```typescript
export const description = "rename column in existing table";

export const current = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, old_name TEXT NOT NULL);
`;

export const next = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
`;

// Optional
export const options = { renameColumns: { users: { old_name: "name" } } };
export const expectNoStatements = false; // true: the schemas are equivalent
export const exclusive = false; // true: run only this case
```

Each case checks that migrating from `current` to `next` succeeds, and that migrating again
produces no statements. Name a new case with the next free number
(`0115_what_it_covers.ts`).

To run one case, filter by its file name:

```sh
pnpm run test test/integration.test.ts -t 0012_
```

## Code style

Biome enforces formatting (double quotes, 2-space indent, 100-character lines) and lint rules.
TypeScript is strict, with `noUncheckedIndexedAccess`. Do not use `any`, and use `import type`
for type-only imports.

## Releasing

`prepublishOnly` runs the checks, the tests and the build. Publish with pnpm:

```sh
pnpm publish
```

`npm publish` does not work: the published `exports` come from `publishConfig`, which only pnpm
applies. `pnpm pack` builds the same tarball without publishing it.
