import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "~/migrate";
import { getBetterSqlite3Database, getLibsqlClient } from "~/sqlite";
import { getDriver } from "~/driver";
import type { SQLite } from "~/sqlite";
import { loadTestCases, type TestCase } from "./load-test-cases";
import { getTestDriver, type TestDriver } from "./test-driver";

describe.skip("sqlrite integration tests", () => {
  describe.each([
    ["libsql", getLibsqlClient],
    ["better-sqlite3", getBetterSqlite3Database],
  ])("using %s", async (clientName, getClient) => {
    const testCases: TestCase[] = await loadTestCases();
    console.log(`loaded ${testCases.length} test cases`);

    describe.each(testCases)("$description", ({ current, next, verify }) => {
      let client: SQLite;
      let driver: TestDriver;

      beforeEach(async () => {
        client = await getClient();
        driver = getTestDriver(getDriver(client));
        await driver.execute(current);
      });

      afterEach(async () => {
        if ("close" in client) {
          await client.close();
        }
      });

      it("applies migration successfully", async () => {
        const res = await migrate(client, next);
        expect(res.success).toBe(true);
        expect(res.err).toBeUndefined();
        await verify(driver);
      });
    });
  });
});
