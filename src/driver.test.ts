import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { getDriver, getDriverType, getNextDriver } from "./driver";
import {
  type SQLite,
  getBetterSqlite3Database,
  getLibsqlClient,
  getNodeSqliteDatabase,
} from "./sqlite";
import { registerFactoryModule } from "./test-utils";

describe("Driver module", () => {
  describe("getDriverType function", () => {
    it("should return 'libsql' for libsql client", async () => {
      const client = await getLibsqlClient();
      const type = getDriverType(client);
      expect(type).toBe("libsql");
    });

    it("should return 'sqlite' for better-sqlite3 database", async () => {
      const db = await getBetterSqlite3Database();
      const type = getDriverType(db);
      expect(type).toBe("sqlite");
    });

    it("should throw TypeError for unsupported client", () => {
      const fakeClient = {} as SQLite;
      expect(() => getDriverType(fakeClient)).toThrow(TypeError);
      expect(() => getDriverType(fakeClient)).toThrow("Unsupported client");
    });
  });

  describe("getDriver function", () => {
    it("should return libsql driver when given a libsql client", async () => {
      const client = await getLibsqlClient();
      const driver = getDriver(client);

      expect(driver).toHaveProperty("execute");
      expect(driver).toHaveProperty("query");
      expect(driver).toHaveProperty("migrate");
      expect(typeof driver.execute).toBe("function");
      expect(typeof driver.query).toBe("function");
      expect(typeof driver.migrate).toBe("function");
    });

    it("should return better-sqlite3 driver when given a better-sqlite3 database", async () => {
      const db = await getBetterSqlite3Database();
      const driver = getDriver(db);

      expect(driver).toHaveProperty("execute");
      expect(driver).toHaveProperty("query");
      expect(driver).toHaveProperty("migrate");
      expect(typeof driver.execute).toBe("function");
      expect(typeof driver.query).toBe("function");
      expect(typeof driver.migrate).toBe("function");
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

    it("should successfully migrate with valid SQL statements", async () => {
      const migrations = [
        "DROP TABLE IF EXISTS test_migrate",
        "CREATE TABLE test_migrate (id INTEGER PRIMARY KEY, name TEXT)",
        "INSERT INTO test_migrate (id, name) VALUES (1, 'test')",
      ];

      const migrateResult = await driver.migrate(migrations);

      expect(migrateResult.success).toBe(true);
      expect(migrateResult.err).toBeUndefined();

      const result = await driver.query<{ id: number; name: string }>("SELECT * FROM test_migrate");

      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 1, name: "test" });
    });

    it("should return error result when migration fails", async () => {
      const invalidMigrations = [
        "DROP TABLE IF EXISTS test_migrate_fail",
        "CREATE TABLE test_migrate_fail (id INTEGER PRIMARY KEY)",
        "INVALID SQL STATEMENT",
      ];
      const migrateResult = await driver.migrate(invalidMigrations);

      expect(migrateResult.success).toBe(false);
      expect(migrateResult.err).toBeInstanceOf(Error);
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

    it("should successfully migrate with valid SQL statements", async () => {
      const migrations = [
        "DROP TABLE IF EXISTS test_migrate",
        "CREATE TABLE test_migrate (id INTEGER PRIMARY KEY, name TEXT)",
        "INSERT INTO test_migrate (id, name) VALUES (1, 'test')",
      ];

      const migrateResult = await driver.migrate(migrations);

      expect(migrateResult.success).toBe(true);
      expect(migrateResult.err).toBeUndefined();

      const result = await driver.query<{ id: number; name: string }>("SELECT * FROM test_migrate");

      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ id: 1, name: "test" });
    });

    it("should return error result when migration fails", async () => {
      const invalidMigrations = [
        "DROP TABLE IF EXISTS test_migrate_fail",
        "CREATE TABLE test_migrate_fail (id INTEGER PRIMARY KEY)",
        "INVALID SQL STATEMENT",
      ];

      const migrateResult = await driver.migrate(invalidMigrations);

      expect(migrateResult.success).toBe(false);
      expect(migrateResult.err).toBeInstanceOf(Error);
    });
  });

  describe("getNextDriver function", () => {
    const testDDL = "CREATE TABLE IF NOT EXISTS test_next (id INTEGER PRIMARY KEY)";

    it("should create new libsql driver with DDL when given libsql client", async () => {
      const client = await getLibsqlClient();
      const nextDriver = await getNextDriver(client, testDDL);

      expect(nextDriver).toHaveProperty("execute");
      expect(nextDriver).toHaveProperty("query");
      expect(typeof nextDriver.execute).toBe("function");
      expect(typeof nextDriver.query).toBe("function");

      const result = await nextDriver.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_next'",
      );
      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("test_next");
    });

    it("should create new better-sqlite3 driver with DDL when given better-sqlite3 database", async () => {
      const db = await getBetterSqlite3Database();
      const nextDriver = await getNextDriver(db, testDDL);

      expect(nextDriver).toHaveProperty("execute");
      expect(nextDriver).toHaveProperty("query");
      expect(typeof nextDriver.execute).toBe("function");
      expect(typeof nextDriver.query).toBe("function");

      const result = await nextDriver.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_next'",
      );
      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("test_next");
    });

    it("should throw TypeError for unsupported client", async () => {
      const fakeClient = {} as SQLite;
      await expect(getNextDriver(fakeClient, testDDL)).rejects.toThrow(TypeError);
      await expect(getNextDriver(fakeClient, testDDL)).rejects.toThrow("Unsupported client");
    });

    it("should throw error when DDL is invalid", async () => {
      const client = await getLibsqlClient();
      await expect(getNextDriver(client, "INVALID SQL")).rejects.toThrow();
    });

    describe.each([
      ["libsql", getLibsqlClient],
      ["better-sqlite3", getBetterSqlite3Database],
      ["node:sqlite", getNodeSqliteDatabase],
    ])("prepare hook with %s", (_name, getClient) => {
      it("runs on a fresh scratch client before the DDL", async () => {
        const client = await getClient();
        const seen: { scratch: SQLite; tables: string[] }[] = [];

        const nextDriver = await getNextDriver(client, testDDL, async (scratch) => {
          const tables = await getDriver(scratch).query<{ name: string }>(
            "SELECT name FROM sqlite_schema WHERE type = 'table'",
          );
          seen.push({ scratch, tables: tables.map((t) => t.name) });
        });

        expect(seen).toHaveLength(1);
        expect(seen[0]?.scratch).not.toBe(client);
        expect(seen[0]?.tables).toEqual([]);

        const result = await nextDriver.query<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type = 'table'",
        );
        expect(result.map((r) => r.name)).toEqual(["test_next"]);
      });

      it("builds the desired schema on the client the hook prepared", async () => {
        const client = await getClient();
        const nextDriver = await getNextDriver(client, testDDL, async (scratch) => {
          await getDriver(scratch).execute("CREATE TABLE from_hook (id INTEGER)");
        });

        const result = await nextDriver.query<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        );
        expect(result.map((r) => r.name)).toEqual(["from_hook", "test_next"]);
      });

      it("propagates errors thrown by the hook", async () => {
        const client = await getClient();
        await expect(
          getNextDriver(client, testDDL, () => {
            throw new Error("hook failed");
          }),
        ).rejects.toThrow("hook failed");
      });
    });

    it("opens the node:sqlite scratch database with extension loading allowed", async () => {
      const client = await getNodeSqliteDatabase();
      let loadError: unknown;

      await getNextDriver(client, testDDL, (scratch) => {
        try {
          (scratch as DatabaseSync).loadExtension("/nonexistent/sqlrite-missing-extension");
        } catch (err) {
          loadError = err;
        }
      });

      // The load attempt reaches dlopen instead of being refused with
      // ERR_INVALID_STATE ("extension loading is not allowed")
      expect(loadError).toBeInstanceOf(Error);
      expect((loadError as Error & { code?: string }).code).not.toBe("ERR_INVALID_STATE");
      expect((loadError as Error).message).not.toMatch(/not allowed/);
    });

    // Node's permission model refuses to open a database with allowExtension,
    // so the scratch database must only ask for it when a hook may load one
    it("migrates a node:sqlite database under Node's permission model without a hook", () => {
      const migratePath = resolve(__dirname, "migrate.ts");
      const script = `
        const { DatabaseSync } = await import("node:sqlite");
        const mod = await import(${JSON.stringify(migratePath)});
        const migrate = mod.migrate ?? mod.default.migrate;
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
        const res = await migrate(db, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");
        console.log(JSON.stringify({ success: res.success, statements: res.statements }));
      `;
      const child = spawnSync(
        process.execPath,
        [
          "--no-warnings",
          "--permission",
          "--allow-fs-read=*",
          "--allow-fs-write=*",
          "--allow-child-process",
          "--allow-worker",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          script,
        ],
        { encoding: "utf8", cwd: resolve(__dirname, "..") },
      );

      expect(child.stderr).toBe("");
      expect(JSON.parse(child.stdout)).toEqual({
        success: true,
        statements: ['ALTER TABLE "users" ADD COLUMN "email" TEXT;'],
      });
    });

    it("lets a better-sqlite3 hook register a module the DDL uses", async () => {
      const client = await getBetterSqlite3Database();
      const ddl = "CREATE VIRTUAL TABLE kv USING hook_module(a)";

      await expect(getNextDriver(client, ddl)).rejects.toThrow(/no such module/);

      const nextDriver = await getNextDriver(client, ddl, (scratch) => {
        registerFactoryModule(scratch as Database, "hook_module");
      });
      const rows = await nextDriver.query<{ k: string }>("SELECT k FROM kv");
      expect(rows).toEqual([{ k: "a" }]);
    });
  });
});
