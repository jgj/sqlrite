import type { TestDriver } from "@/test-driver";
import { expect } from "vitest";

export const description = "test removing a NOT NULL constraint using table recreation";

// the SQL DDL representing the starting state of the database
export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    bio TEXT NOT NULL
  );
`;

// the SQL DDL representing the desired state of the database
export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    bio TEXT
  );
`;

export async function verify(driver: TestDriver) {
  // Verify the table exists with correct schema
  await driver.tableExists("users");
  await driver.tableHasColumn("users", "id", "INTEGER");
  await driver.tableHasColumn("users", "username", "TEXT");
  await driver.tableHasColumn("users", "email", "TEXT");
  await driver.tableHasColumn("users", "bio", "TEXT");

  // Verify NOT NULL constraints on columns that should have them
  await driver.columnHasConstraint("users", "username", "notnull");
  await driver.columnHasConstraint("users", "email", "notnull");

  // Verify the NOT NULL constraint was removed from bio column
  const notnullQuery = await driver.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name = 'bio' AND "notnull" = 1`,
  );

  expect(notnullQuery[0].count).toBe(0);
}
