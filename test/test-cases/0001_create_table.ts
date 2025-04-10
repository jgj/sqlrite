import type { TestDriver } from "@/test-driver";

export const description = "add new table";

export const current = "";

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export async function verify(driver: TestDriver) {
  await driver.tableExists("users");
  await driver.tableHasColumn("users", "id", "INTEGER");
  await driver.tableHasColumn("users", "name", "TEXT");
  await driver.columnHasConstraint("users", "name", "notnull");
}
