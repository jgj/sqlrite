import type { TestDriver } from "@/test-driver";

export const description = "rename column in existing table";

// Start with a table that has a column we want to rename
export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    old_name TEXT NOT NULL
  );
`;

// The desired state with the column renamed
export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("ALTER TABLE users RENAME COLUMN old_name TO name");

  // Verify the table exists and has correct structure
  await driver.tableExists("users");
  await driver.tableHasColumn("users", "id", "INTEGER");
  await driver.tableHasColumn("users", "name", "TEXT");
  await driver.columnHasConstraint("users", "name", "notnull");

  // Verify the old column name no longer exists
  await driver.columnNotExists("users", "old_name");
}
