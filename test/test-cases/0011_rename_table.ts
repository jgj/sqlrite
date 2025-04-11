import type { TestDriver } from "@/test-driver";

export const description = "rename table";

// Initial state with the original table
export const current = `
  CREATE TABLE old_users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

// Desired state with the renamed table
export const next = `
  CREATE TABLE new_users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("ALTER TABLE old_users RENAME TO new_users");

  // Verify old table no longer exists
  await driver.tableNotExists("old_users");

  // Verify new table exists with correct structure
  await driver.tableExists("new_users");
  await driver.tableHasColumn("new_users", "id", "INTEGER");
  await driver.tableHasColumn("new_users", "name", "TEXT");
  await driver.columnHasConstraint("new_users", "name", "notnull");
}
