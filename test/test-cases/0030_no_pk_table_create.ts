import type { TestDriver } from "@/test-driver";

export const description = "test creating a table with no primary key";

// Starting with an empty database
export const current = "";

// Creating a table without a primary key
export const next = `
  CREATE TABLE logs (
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT
  );
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("CREATE TABLE logs");

  await driver.tableExists("logs");
  await driver.tableHasColumn("logs", "timestamp", "TEXT");
  await driver.tableHasColumn("logs", "level", "TEXT");
  await driver.tableHasColumn("logs", "message", "TEXT");
  await driver.tableHasColumn("logs", "details", "TEXT");

  // Verify column constraints
  await driver.columnHasConstraint("logs", "timestamp", "notnull");
  await driver.columnHasConstraint("logs", "level", "notnull");
  await driver.columnHasConstraint("logs", "message", "notnull");

  // Verify the table has no primary key
  await driver.tablePrimaryKeyColumns("logs", []);
}
