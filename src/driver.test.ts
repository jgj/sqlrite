import { beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "./driver";
import { type SQLite, getBetterSqlite3Database, getLibsqlClient } from "./sqlite";

describe("Driver module", () => {
  describe("getDriver function", () => {
    it("should return libsql driver when given a libsql client", async () => {
      const client = await getLibsqlClient();
      const driver = getDriver(client);

      expect(driver).toHaveProperty("execute");
      expect(driver).toHaveProperty("query");
      expect(typeof driver.execute).toBe("function");
      expect(typeof driver.query).toBe("function");
    });

    it("should return better-sqlite3 driver when given a better-sqlite3 database", async () => {
      const db = await getBetterSqlite3Database();
      const driver = getDriver(db);

      expect(driver).toHaveProperty("execute");
      expect(driver).toHaveProperty("query");
      expect(typeof driver.execute).toBe("function");
      expect(typeof driver.query).toBe("function");
    });

    it("should throw TypeError for unsupported client", () => {
      const fakeClient = {} as SQLite;

      expect(() => getDriver(fakeClient)).toThrow(TypeError);
      expect(() => getDriver(fakeClient)).toThrow("Unsupported client");
    });
  });

  describe("libsql driver", () => {
    let client: SQLite;
    let driver: ReturnType<typeof getDriver>;

    beforeEach(async () => {
      client = await getLibsqlClient();
      driver = getDriver(client);
    });

    it("should query a simple select successfully", async () => {
      const result = await driver.query<{ value: number }>("SELECT 1 as value");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty("value", 1);
    });

    it("should query multiple rows", async () => {
      const result = await driver.query<{ num: number }>(
        "SELECT 1 as num UNION SELECT 2 UNION SELECT 3",
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result.map((row) => row.num)).toEqual([1, 2, 3]);
    });

    it("should handle queries that return no rows", async () => {
      const result = await driver.query("SELECT 1 WHERE 1=0");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it("should execute void operations", async () => {
      await expect(
        driver.execute("CREATE TABLE IF NOT EXISTS test (id INTEGER)"),
      ).resolves.toBeUndefined();
    });

    it("should handle execution errors", async () => {
      await expect(driver.execute("INVALID SQL QUERY")).rejects.toThrow();
    });
  });

  describe("better-sqlite3 driver", () => {
    let db: SQLite;
    let driver: ReturnType<typeof getDriver>;

    beforeEach(async () => {
      db = await getBetterSqlite3Database();
      driver = getDriver(db);
    });

    it("should query a simple select successfully", async () => {
      const result = await driver.query<{ value: number }>("SELECT 1 as value");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty("value", 1);
    });

    it("should query multiple rows", async () => {
      const result = await driver.query<{ num: number }>(
        "SELECT 1 as num UNION SELECT 2 UNION SELECT 3",
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result.map((row) => row.num)).toEqual([1, 2, 3]);
    });

    it("should handle queries that return no rows", async () => {
      const result = await driver.query("SELECT 1 WHERE 1=0");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it("should execute void operations", async () => {
      await expect(
        driver.execute("CREATE TABLE IF NOT EXISTS test (id INTEGER)"),
      ).resolves.toBeUndefined();
    });

    it("should handle execution errors", async () => {
      await expect(driver.execute("INVALID SQL QUERY")).rejects.toThrow();
    });
  });
});
