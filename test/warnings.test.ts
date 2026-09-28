import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "../src/driver";
import { migrate } from "../src/migrate";
import { getMigrationPreview } from "../src/migration-statements";
import { getBetterSqlite3Database, getLibsqlClient, getNodeSqliteDatabase } from "../src/sqlite";
import type { SQLite } from "../src/sqlite";

describe("migration warnings", () => {
  let client: SQLite;

  beforeEach(async () => {
    client = await getLibsqlClient();
  });

  afterEach(async () => {
    if ("close" in client) {
      await client.close();
    }
  });

  it("warns when dropping a table", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE TABLE old_data (id INTEGER PRIMARY KEY, value TEXT);");

    const preview = await getMigrationPreview(client, "");
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]?.type).toBe("destructive");
    expect(preview.warnings[0]?.message).toContain("old_data");
    expect(preview.warnings[0]?.message).toContain("dropped");
  });

  it("warns when dropping a column", async () => {
    const driver = getDriver(client);
    await driver.execute(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, legacy TEXT);",
    );

    const preview = await getMigrationPreview(
      client,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
    );

    expect(
      preview.warnings.some((w) => w.type === "destructive" && w.message.includes("legacy")),
    ).toBe(true);
  });

  it("warns when recreating a table with dropped columns", async () => {
    const driver = getDriver(client);
    await driver.execute(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, old_field TEXT, email TEXT NOT NULL);",
    );

    const preview = await getMigrationPreview(
      client,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE);",
    );

    const destructive = preview.warnings.filter((w) => w.type === "destructive");
    expect(destructive.length).toBeGreaterThan(0);
    expect(destructive.some((w) => w.message.includes("old_field"))).toBe(true);
  });

  it("warns with caution when recreating a table without data loss", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");

    const preview = await getMigrationPreview(
      client,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) > 0));",
    );

    const cautions = preview.warnings.filter((w) => w.type === "caution");
    expect(cautions.length).toBeGreaterThan(0);
    expect(cautions[0]?.message).toContain("recreated");
  });

  it("returns no warnings when no changes", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");

    const preview = await getMigrationPreview(
      client,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
    );

    expect(preview.warnings).toHaveLength(0);
    expect(preview.statements).toHaveLength(0);
  });

  it("returns no warnings for safe operations", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");

    const preview = await getMigrationPreview(
      client,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT DEFAULT '');",
    );

    expect(preview.warnings).toHaveLength(0);
    expect(preview.statements.length).toBeGreaterThan(0);
  });

  it("warns when dropping a virtual table", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE VIRTUAL TABLE shapes USING rtree(id, minX, maxX);");

    const preview = await getMigrationPreview(client, "", { manageVirtualTables: true });

    expect(preview.warnings).toEqual([
      {
        type: "destructive",
        message:
          'Virtual table "shapes" will be dropped. Data in virtual table "shapes" will be lost.',
      },
    ]);
  });

  it("warns that a virtual table recreated by DROP + CREATE loses its data", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE VIRTUAL TABLE shapes USING rtree(id, minX, maxX);");

    const preview = await getMigrationPreview(
      client,
      "CREATE VIRTUAL TABLE shapes USING rtree(id, minX, maxX, minY, maxY);",
      { manageVirtualTables: true },
    );

    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]?.type).toBe("destructive");
    expect(preview.warnings[0]?.message).toContain("recreated with DROP + CREATE");
    expect(preview.warnings[0]?.message).toContain('Data in virtual table "shapes" will be lost');
  });

  it("does not warn about virtual tables when they are not managed", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE VIRTUAL TABLE shapes USING rtree(id, minX, maxX);");

    const preview = await getMigrationPreview(client, "");

    expect(preview.warnings).toEqual([]);
  });

  it("migrate result includes warnings", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE TABLE old_data (id INTEGER PRIMARY KEY, value TEXT);");

    const result = await migrate(client, "");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]?.type).toBe("destructive");
  });
});

// The live schema is read from main, but the statements name objects without
// a schema, and SQLite looks a bare name up in temp first
describe.each([
  ["libsql", getLibsqlClient],
  ["better-sqlite3", getBetterSqlite3Database],
  ["node:sqlite", getNodeSqliteDatabase],
])("a temp object named like an object the migration changes, using %s", (_name, getClient) => {
  let client: SQLite;

  beforeEach(async () => {
    client = await getClient();
  });

  afterEach(async () => {
    if ("close" in client) {
      await client.close();
    }
  });

  const articles = "CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT);";
  const columns = async (schema: string) => {
    const rows = await getDriver(client).query<{ name: string }>(
      `SELECT name FROM pragma_table_info('articles', '${schema}')`,
    );
    return rows.map((r) => r.name);
  };

  it("is reported, and the migration is refused without changing anything", async () => {
    await getDriver(client).execute(`${articles}\nCREATE TEMP TABLE articles (q);`);
    const next = "CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT, z INT);";

    const preview = await getMigrationPreview(client, next);
    expect(preview.warnings).toEqual([
      { type: "destructive", message: expect.stringContaining('temp table "articles"') },
    ]);

    const result = await migrate(client, next);
    expect(result.success).toBe(false);
    expect(result.err?.message).toContain('temp table "articles"');
    expect(await columns("main")).toEqual(["id", "title", "body"]);
    expect(await columns("temp")).toEqual(["q"]);
  });

  it("does not stop a migration that does not touch it", async () => {
    await getDriver(client).execute(
      `${articles}\nCREATE TABLE other (x);\nCREATE TEMP TABLE other (q);`,
    );
    const next = `CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT, z INT);
      CREATE TABLE other (x);`;

    const result = await migrate(client, next);
    expect(result.success, result.err?.message).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(await columns("main")).toEqual(["id", "title", "body", "z"]);
  });
});
