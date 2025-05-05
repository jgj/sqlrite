import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Driver, getDriver } from "~/driver";
import { migrate } from "~/migrate";
import { getBetterSqlite3Database, getLibsqlClient } from "~/sqlite";
import type { SQLite } from "~/sqlite";
import { type TestCase, loadTestCases } from "./load-test-cases";
import { getTestDriver } from "./test-driver";

describe("sqlrite integration tests", () => {
  describe.each([
    ["libsql", getLibsqlClient],
    // ["better-sqlite3", getBetterSqlite3Database],
  ])("using %s", async (clientName, getClient) => {
    const testCases: TestCase[] = await loadTestCases();

    const exc = testCases.find((c) => c.exclusive);
    const tests = exc ? [exc] : testCases;

    describe.each(tests)("$filename $description", ({ current, next, verify, filename }) => {
      let client: SQLite;
      let driver: Driver;

      beforeEach(async () => {
        client = await getClient();
        driver = getDriver(client);
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
        expect(res.success, `\nGenerated Statements:\n\t${res.statements.join("\n\t")}\n`).toBe(true);
        expect(res.err).toBeUndefined();
      });

      it("applies migration successfully", async () => {
        const res = await migrate(client, next);
        await verify(
          getTestDriver(driver, { case: filename, client: clientName, statements: res.statements }),
        );
      });
    });
  });
});
