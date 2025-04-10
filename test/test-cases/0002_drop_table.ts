import type { TestDriver } from "@/test-driver";

export const description = "drop existing table";

// Initial state: create a table that we'll then drop
export const current = `
  CREATE TABLE temp_users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

// The migration that drops the table
export const next = "";

export async function verify(driver: TestDriver) {
  // Let's verify that the table no longer exists
  // We'll need to add a tableNotExists helper to TestDriver
  await driver.tableNotExists("temp_users");
}
