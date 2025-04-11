import type { TestDriver } from "@/test-driver";

export const description = "create an index on a table";

// Initial database state with a table but no index
export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL
  );
`;

// Desired state with an index on the email column
export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL
  );
  
  CREATE INDEX idx_users_email ON users(email);
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("CREATE INDEX idx_users_email");

  // Verify the table still exists with correct structure
  await driver.tableExists("users");
  await driver.tableHasColumn("users", "id", "INTEGER");
  await driver.tableHasColumn("users", "email", "TEXT");
  await driver.columnHasConstraint("users", "email", "notnull");

  // Verify the index exists
  await driver.indexExists("users", "idx_users_email");
}
