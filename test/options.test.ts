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
      expect(preview.plan[0].type).toBe("rename");
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

    it("default behavior (option unset) still drops orphan tables", async () => {
      const driver = getDriver(client);
      await driver.execute("CREATE TABLE legacy (id INTEGER PRIMARY KEY);");

      const preview = await getMigrationPreview(client, "");

      expect(preview.statements.some((s) => /DROP TABLE.*legacy/i.test(s))).toBe(true);
      expect(preview.warnings.some((w) => w.type === "destructive")).toBe(true);
    });
  });
});
