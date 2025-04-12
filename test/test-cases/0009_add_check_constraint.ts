import type { TestDriver } from "@/test-driver";

export const description = "add check constraint";

// Initial state: table without check constraint
export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL
  );
`;

// Desired state: same table with check constraint on price
export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0)
  );
`;

export async function verify(driver: TestDriver) {
  // Should use table recreation since SQLite doesn't directly support adding CHECK constraints
  driver.ddl.expectStatementCount(4);
  driver.ddl.expectStatement('CREATE TABLE "temp_products"');
  driver.ddl.expectStatement('INSERT INTO "temp_products"');
  driver.ddl.expectStatement('DROP TABLE "products"');
  driver.ddl.expectStatement('ALTER TABLE "temp_products" RENAME TO "products"');

  await driver.tableExists("products");
  await driver.tableHasColumn("products", "id", "INTEGER");
  await driver.tableHasColumn("products", "name", "TEXT");
  await driver.tableHasColumn("products", "price", "INTEGER");
  await driver.columnHasConstraint("products", "price", "notnull");
  await driver.columnHasCheckConstraint("products", "price", "price >= 0");
}
