import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "~/migrate";
import { getBetterSqlite3Database, getLibsqlClient } from "~/sqlite";
import { getDriver, type Driver } from "~/driver";
import type { SQLite } from "~/sqlite";
import { loadTestCases, type TestCase } from "./load-test-cases";
import { getTestDriver, type TestDriver } from "./test-driver";

describe("sqlrite integration tests", () => {
  describe.each([
    ["libsql", getLibsqlClient],
    ["better-sqlite3", getBetterSqlite3Database],
  ])("using %s", async (clientName, getClient) => {
    const testCases: TestCase[] = await loadTestCases();
    console.log(`loaded ${testCases.length} test cases`);

    describe.each(testCases)("$description", ({ current, next, verify, filename }) => {
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
        expect(res.success, `\n${res.statements.join("\n\t")}\n`).toBe(true);
        expect(res.err).toBeUndefined();
      });

      it("applies migration successfully", async () => {
        await migrate(client, next);
        await verify(getTestDriver(driver, { case: filename, client: clientName }));
      });
    });
  });
});
