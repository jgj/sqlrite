import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "~/driver";
import { migrate } from "~/migrate";
import { getLibsqlClient } from "~/sqlite";
import type { SQLite } from "~/sqlite";
import { type TestCase, loadTestCases } from "./load-test-cases";

describe("sqlrite integration tests", () => {
  describe.each([
    ["libsql", getLibsqlClient],
    // ["better-sqlite3", getBetterSqlite3Database],
  ])("using %s", async (clientName, getClient) => {
    const testCases: TestCase[] = await loadTestCases();

    const exc = testCases.find((c) => c.exclusive);
    const tests = exc ? [exc] : testCases;

    describe.each(tests)("$filename $description", ({ current, next }) => {
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
        const res = await migrate(client, next);
        expect(Array.isArray(res.statements)).toBe(true);
        expect(res.success, `\nGenerated Statements:\n\t${res.statements.join("\n\t")}\n`).toBe(
          true,
        );
        expect(res.err).toBeUndefined();
      });

      it("is idempotent", async () => {
        // First migration: apply the schema change
        const first = await migrate(client, next);
        expect(
          first.success,
          `\nFirst migration failed:\n\t${first.statements.join("\n\t")}\n`,
        ).toBe(true);

        // Second migration: should produce zero statements (schema already matches)
        const second = await migrate(client, next);
        expect(
          second.statements,
          `\nExpected no statements on second migration, but got:\n\t${second.statements.join("\n\t")}\n`,
        ).toEqual([]);
      });
    });
  });
});
