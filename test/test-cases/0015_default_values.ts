import type { TestDriver } from "@/test-driver";

export const description = "test columns with default values";

// Starting with an empty database
export const current = "";

// Creating a table with various types of default values
export const next = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    count INTEGER DEFAULT 0,
    name TEXT DEFAULT 'unnamed',
    rate REAL DEFAULT 1.5
  );
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("CREATE TABLE settings");

  await driver.tableExists("settings");
  await driver.tableHasColumn("settings", "id", "INTEGER");
  await driver.tableHasColumn("settings", "is_active", "BOOLEAN");
  await driver.tableHasColumn("settings", "created_at", "TIMESTAMP");
  await driver.tableHasColumn("settings", "count", "INTEGER");
  await driver.tableHasColumn("settings", "name", "TEXT");
  await driver.tableHasColumn("settings", "rate", "REAL");

  // Verify default values for each column
  await driver.columnHasDefault("settings", "is_active", "true");
  await driver.columnHasDefault("settings", "created_at", "CURRENT_TIMESTAMP");
  await driver.columnHasDefault("settings", "count", "0");
  await driver.columnHasDefault("settings", "name", "'unnamed'");
  await driver.columnHasDefault("settings", "rate", "1.5");
}
