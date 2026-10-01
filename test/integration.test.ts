import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "../src/driver";
import { migrate } from "../src/migrate";
import { getBetterSqlite3Database, getLibsqlClient, getNodeSqliteDatabase } from "../src/sqlite";
import type { SQLite } from "../src/sqlite";
import { type TestCase, loadTestCases } from "./load-test-cases";

describe("sqlrite integration tests", () => {
  describe.each([
    ["libsql", getLibsqlClient],
    ["better-sqlite3", getBetterSqlite3Database],
    ["node:sqlite", getNodeSqliteDatabase],
  ])("using %s", async (clientName, getClient) => {
    const testCases: TestCase[] = await loadTestCases();

    const exc = testCases.find((c) => c.exclusive);
    const tests = exc ? [exc] : testCases;

    describe.each(tests)(
      "$filename $description",
      ({ current, next, expectNoStatements, options }) => {
        let client: SQLite;

        beforeEach(async () => {
          client = await getClient();
          const driver = getDriver(client);
          await driver.execute(current);
        });

        afterEach(async () => {
          if ("close" in client) {
            await client.close();
          }
        });

        it("applies migration without error", async () => {
          const res = await migrate(client, next, options);
          expect(Array.isArray(res.statements)).toBe(true);
          expect(res.success, `\nGenerated Statements:\n\t${res.statements.join("\n\t")}\n`).toBe(
            true,
          );
          expect(res.err).toBeUndefined();
          if (expectNoStatements) expect(res.statements).toEqual([]);
        });

        it("is idempotent", async () => {
          // First migration: apply the schema change
          const first = await migrate(client, next, options);
          expect(
            first.success,
            `\nFirst migration failed:\n\t${first.statements.join("\n\t")}\n`,
          ).toBe(true);

          // Second migration: should produce zero statements (schema already matches)
          const second = await migrate(client, next, options);
          expect(
            second.statements,
            `\nExpected no statements on second migration, but got:\n\t${second.statements.join("\n\t")}\n`,
          ).toEqual([]);
        });
      },
    );
  });
});
