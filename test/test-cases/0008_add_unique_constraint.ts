import type { TestDriver } from "@/test-driver";

export const description = "add unique constraint";
// export const exclusive = true;

// Initial state has a table without unique constraint
export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL
  );
`;

// Desired state adds UNIQUE constraint to email
export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
  );
`;

export async function verify(driver: TestDriver) {
  // Due to SQLite limitations, adding a UNIQUE constraint requires table recreation
  driver.ddl.log();
  driver.ddl.expectStatementCount(4);

  // Verify new table exists with correct structure
  await driver.tableExists("users");
  await driver.tableHasColumn("users", "id", "INTEGER");
  await driver.tableHasColumn("users", "email", "TEXT");
  await driver.columnHasConstraint("users", "email", "notnull");

  // Verify unique constraint via checking for unique index
  // SQLite implements UNIQUE constraints as indexes
  await driver.indexExists("users", "sqlite_autoindex_users_1");
  await driver.indexHasColumns("users", "sqlite_autoindex_users_1", ["email"]);
}
