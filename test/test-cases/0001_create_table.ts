import type { TestDriver } from "@/test-driver";

export const description = "add new table";

// the SQL DDL representing the starting state of the database
export const current = "";

// the SQL DDL representing the desired state of the database
export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("CREATE TABLE users");

  await driver.tableExists("users");
  await driver.tableHasColumn("users", "id", "INTEGER");
  await driver.tableHasColumn("users", "name", "TEXT");
  await driver.columnHasConstraint("users", "name", "notnull");
}
