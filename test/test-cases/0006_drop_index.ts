import type { TestDriver } from "@/test-driver";

export const description = "test dropping an index";

// Initial state includes a table with an index
export const current = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE INDEX idx_items_name ON items(name);
`;

// Desired state is the same table without the index
export const next = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("DROP INDEX idx_items_name");

  // Verify table still exists with correct structure
  await driver.tableExists("items");
  await driver.tableHasColumn("items", "id", "INTEGER");
  await driver.tableHasColumn("items", "name", "TEXT");
  await driver.columnHasConstraint("items", "name", "notnull");

  // Verify index is dropped
  await driver.indexNotExists("items", "idx_items_name");
}
