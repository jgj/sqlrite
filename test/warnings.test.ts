import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "../src/driver";
import { migrate } from "../src/migrate";
import { getMigrationPreview } from "../src/migration-statements";
import { getLibsqlClient } from "../src/sqlite";
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
    expect(preview.warnings[0].type).toBe("destructive");
    expect(preview.warnings[0].message).toContain("old_data");
    expect(preview.warnings[0].message).toContain("dropped");
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
    expect(cautions[0].message).toContain("recreated");
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

  it("migrate result includes warnings", async () => {
    const driver = getDriver(client);
    await driver.execute("CREATE TABLE old_data (id INTEGER PRIMARY KEY, value TEXT);");

    const result = await migrate(client, "");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].type).toBe("destructive");
  });
});
