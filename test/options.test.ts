import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "../src/driver";
import { migrate } from "../src/migrate";
import { getMigrationPreview } from "../src/migration-statements";
import type { SQLite } from "../src/sqlite";
import { getLibsqlClient } from "../src/sqlite";

describe("MigrationOptions", () => {
  describe("ignoreTableDeletion", () => {
    let client: SQLite;

    beforeEach(async () => {
      client = await getLibsqlClient();
    });

    afterEach(async () => {
      if ("close" in client) {
        await client.close();
      }
    });

    it("does not drop a table that exists only in the current schema", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE legacy (id INTEGER PRIMARY KEY, value TEXT); CREATE TABLE keep (id INTEGER PRIMARY KEY);",
      );

      const preview = await getMigrationPreview(
        client,
        "CREATE TABLE keep (id INTEGER PRIMARY KEY);",
        { ignoreTableDeletion: true },
      );

      expect(preview.statements).toEqual([]);
      expect(preview.warnings).toEqual([]);
    });

    it("leaves the orphan table data intact after migrate runs", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE legacy (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO legacy (value) VALUES ('keepme');",
      );

      await migrate(client, "", { ignoreTableDeletion: true });

      const rows = await driver.query<{ value: string }>("SELECT value FROM legacy");
      expect(rows).toEqual([{ value: "keepme" }]);
    });

    it("does not drop indexes belonging to ignored tables", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE legacy (id INTEGER PRIMARY KEY, value TEXT); CREATE INDEX legacy_value_idx ON legacy (value);",
      );

      const preview = await getMigrationPreview(client, "", { ignoreTableDeletion: true });

      expect(preview.statements).toEqual([]);
    });

    it("does not drop triggers belonging to ignored tables", async () => {
      const driver = getDriver(client);
      await driver.execute(`
        CREATE TABLE legacy (id INTEGER PRIMARY KEY, value TEXT);
        CREATE TABLE audit (msg TEXT);
        CREATE TRIGGER legacy_after_insert AFTER INSERT ON legacy
          BEGIN INSERT INTO audit (msg) VALUES (NEW.value); END;
      `);

      const preview = await getMigrationPreview(client, "CREATE TABLE audit (msg TEXT);", {
        ignoreTableDeletion: true,
      });

      expect(preview.statements).toEqual([]);
    });

    it("does not drop views that depend only on ignored tables", async () => {
      const driver = getDriver(client);
      await driver.execute(`
        CREATE TABLE legacy (id INTEGER PRIMARY KEY, value TEXT);
        CREATE VIEW legacy_view AS SELECT id, value FROM legacy;
      `);

      const preview = await getMigrationPreview(client, "", { ignoreTableDeletion: true });

      expect(preview.statements).toEqual([]);
    });

    it("still emits rename when a drop+create pair resolves to a rename", async () => {
      const driver = getDriver(client);
      await driver.execute("CREATE TABLE old_name (id INTEGER PRIMARY KEY, value TEXT);");

      const preview = await getMigrationPreview(
        client,
        "CREATE TABLE new_name (id INTEGER PRIMARY KEY, value TEXT);",
        { ignoreTableDeletion: true },
      );

      expect(preview.plan).toHaveLength(1);
      expect(preview.plan[0]?.type).toBe("rename");
      expect(preview.statements.some((s) => /ALTER TABLE.*RENAME/i.test(s))).toBe(true);
    });

    it("still applies non-deletion changes to tables present in desired", async () => {
      const driver = getDriver(client);
      await driver.execute(`
        CREATE TABLE legacy (id INTEGER PRIMARY KEY);
        CREATE TABLE users (id INTEGER PRIMARY KEY);
      `);

      const preview = await getMigrationPreview(
        client,
        "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);",
        { ignoreTableDeletion: true },
      );

      expect(preview.statements.length).toBeGreaterThan(0);
      expect(preview.statements.some((s) => /ALTER TABLE.*ADD COLUMN.*email/i.test(s))).toBe(true);
      expect(preview.statements.some((s) => /DROP TABLE.*legacy/i.test(s))).toBe(false);
    });

    it("does not drop virtual tables when manageVirtualTables is on", async () => {
      const driver = getDriver(client);
      await driver.execute(`
        CREATE VIRTUAL TABLE legacy_idx USING rtree(id, minX, maxX);
        CREATE VIEW legacy_idx_view AS SELECT id FROM legacy_idx;
      `);

      const preview = await getMigrationPreview(client, "", {
        ignoreTableDeletion: true,
        manageVirtualTables: true,
      });

      expect(preview.statements).toEqual([]);
      expect(preview.warnings).toEqual([]);
    });

    // A declared view that reads a kept (undeclared) table resolves to fewer
    // tables in the desired schema; that alone must not recreate it
    describe.each([
      ["a table", "CREATE TABLE s (id INTEGER PRIMARY KEY, body TEXT);", {}],
      [
        "a virtual table",
        "CREATE VIRTUAL TABLE s USING fts5(body);",
        { manageVirtualTables: true },
      ],
    ])("a declared view over %s the desired schema omits", (_what, s, extra) => {
      const options = { ignoreTableDeletion: true, ...extra };

      it("is left alone", async () => {
        const driver = getDriver(client);
        await driver.execute(`${s}\nCREATE VIEW v AS SELECT body FROM s;`);
        const next = "CREATE VIEW v AS SELECT body FROM s;";

        const res = await migrate(client, next, options);
        expect(res.success, res.err?.message).toBe(true);
        expect(res.statements).toEqual([]);
        expect((await getMigrationPreview(client, next, options)).statements).toEqual([]);
      });

      it("is recreated once with a recreated table it also reads", async () => {
        const driver = getDriver(client);
        await driver.execute(`
          CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT);
          ${s}
          CREATE VIEW v AS SELECT t.id FROM t JOIN s ON s.rowid = t.id;
        `);
        const next = `
          CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT NOT NULL);
          CREATE VIEW v AS SELECT t.id FROM t JOIN s ON s.rowid = t.id;
        `;

        const res = await migrate(client, next, options);
        expect(res.success, res.err?.message).toBe(true);
        const again = await migrate(client, next, options);
        expect(again.success, again.err?.message).toBe(true);
        expect(again.statements).toEqual([]);
      });

      it("is still updated when its SQL changes", async () => {
        const driver = getDriver(client);
        await driver.execute(`${s}\nCREATE VIEW v AS SELECT body FROM s;`);
        const next = "CREATE VIEW v AS SELECT body, 1 AS one FROM s;";

        const res = await migrate(client, next, options);
        expect(res.success, res.err?.message).toBe(true);
        const columns = await driver.query<{ name: string }>(
          "SELECT name FROM pragma_table_info('v')",
        );
        expect(columns.map((c) => c.name)).toEqual(["body", "one"]);
        expect((await getMigrationPreview(client, next, options)).statements).toEqual([]);
      });
    });

    // The view is kept (it reads a kept table), but the recreate of the other
    // table it reads has to drop it and put it back as it was
    describe.each([
      ["a table", "CREATE TABLE s (id INTEGER PRIMARY KEY, body TEXT);", {}],
      [
        "a virtual table",
        "CREATE VIRTUAL TABLE s USING fts5(body);",
        { manageVirtualTables: true },
      ],
    ])("an undeclared view over %s the desired schema omits", (_what, s, extra) => {
      const options = { ignoreTableDeletion: true, ...extra };

      it("is kept when another table it reads is recreated", async () => {
        const driver = getDriver(client);
        const view = "CREATE VIEW v AS SELECT p.id, s.body FROM p JOIN s ON s.rowid = p.id";
        await driver.execute(`
          CREATE TABLE p (id INTEGER PRIMARY KEY, body TEXT);
          ${s}
          ${view};
        `);
        const next = "CREATE TABLE p (id INTEGER PRIMARY KEY, body TEXT NOT NULL);";

        const res = await migrate(client, next, options);
        expect(res.success, res.err?.message).toBe(true);
        const views = await driver.query<{ sql: string }>(
          "SELECT sql FROM sqlite_schema WHERE name = 'v'",
        );
        expect(views).toEqual([{ sql: view }]);
        const again = await migrate(client, next, options);
        expect(again.success, again.err?.message).toBe(true);
        expect(again.statements).toEqual([]);
      });
    });

    it("default behavior (option unset) still drops orphan tables", async () => {
      const driver = getDriver(client);
      await driver.execute("CREATE TABLE legacy (id INTEGER PRIMARY KEY);");

      const preview = await getMigrationPreview(client, "");

      expect(preview.statements.some((s) => /DROP TABLE.*legacy/i.test(s))).toBe(true);
      expect(preview.warnings.some((w) => w.type === "destructive")).toBe(true);
    });
  });

  describe("manageVirtualTables", () => {
    let client: SQLite;

    beforeEach(async () => {
      client = await getLibsqlClient();
    });

    afterEach(async () => {
      if ("close" in client) {
        await client.close();
      }
    });

    const shapes = "CREATE VIRTUAL TABLE shapes USING rtree(id, minX, maxX);";

    it("is off by default: virtual tables are neither created nor dropped", async () => {
      const created = await getMigrationPreview(client, shapes);
      expect(created.statements).toEqual([]);

      await getDriver(client).execute(shapes);
      const dropped = await getMigrationPreview(client, "");
      expect(dropped.statements).toEqual([]);
      expect(dropped.warnings).toEqual([]);
    });

    it("creates and drops virtual tables when enabled", async () => {
      const created = await getMigrationPreview(client, shapes, { manageVirtualTables: true });
      expect(created.statements).toEqual([shapes]);

      await getDriver(client).execute(shapes);
      const dropped = await getMigrationPreview(client, "", { manageVirtualTables: true });
      expect(dropped.statements).toEqual(['DROP TABLE IF EXISTS "shapes";']);
    });
  });

  describe("ignoreColumnOrder", () => {
    let client: SQLite;

    beforeEach(async () => {
      client = await getLibsqlClient();
    });

    afterEach(async () => {
      if ("close" in client) {
        await client.close();
      }
    });

    it("emits no statements for a pure reorder when enabled", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);",
      );

      const preview = await getMigrationPreview(
        client,
        "CREATE TABLE products (id INTEGER PRIMARY KEY, price REAL, name TEXT);",
        { ignoreColumnOrder: true },
      );

      expect(preview.statements).toEqual([]);
      expect(preview.warnings).toEqual([]);
    });

    it("default behavior recreates the table for a reorder", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);",
      );

      const preview = await getMigrationPreview(
        client,
        "CREATE TABLE products (id INTEGER PRIMARY KEY, price REAL, name TEXT);",
      );

      expect(preview.plan.some((op) => op.type === "recreate")).toBe(true);
    });

    it("still applies a column add when reorder is also present", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);",
      );

      const preview = await getMigrationPreview(
        client,
        "CREATE TABLE products (id INTEGER PRIMARY KEY, price REAL, name TEXT, sku TEXT);",
        { ignoreColumnOrder: true },
      );

      expect(preview.statements.some((s) => /ALTER TABLE.*ADD COLUMN.*sku/i.test(s))).toBe(true);
    });

    it("still recreates when a column changes type alongside reorder", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);",
      );

      const preview = await getMigrationPreview(
        client,
        "CREATE TABLE products (id INTEGER PRIMARY KEY, price NUMERIC, name TEXT);",
        { ignoreColumnOrder: true },
      );

      expect(preview.plan.some((op) => op.type === "recreate")).toBe(true);
    });

    it("preserves data and column order in the live DB after a no-op ignored reorder", async () => {
      const driver = getDriver(client);
      await driver.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL); INSERT INTO products (name, price) VALUES ('apple', 1.5);",
      );

      await migrate(
        client,
        "CREATE TABLE products (id INTEGER PRIMARY KEY, price REAL, name TEXT);",
        { ignoreColumnOrder: true },
      );

      const rows = await driver.query<{ name: string; price: number }>(
        "SELECT name, price FROM products",
      );
      expect(rows).toEqual([{ name: "apple", price: 1.5 }]);

      // Subsequent runs with the option on should also be no-ops.
      const second = await getMigrationPreview(
        client,
        "CREATE TABLE products (id INTEGER PRIMARY KEY, price REAL, name TEXT);",
        { ignoreColumnOrder: true },
      );
      expect(second.statements).toEqual([]);
    });
  });
});
