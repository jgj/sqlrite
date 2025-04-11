import type { TestDriver } from "@/test-driver";

export const description = "create composite index on multiple columns";

// Starting state with a table but no index
export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL
  );
`;

// Desired state with a composite index on category and name
export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL
  );

  CREATE INDEX idx_products_category_name ON products(category, name);
`;

export async function verify(driver: TestDriver) {
  // Verify the DDL statement count and content
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("CREATE INDEX idx_products_category_name");

  // Verify the table exists with all columns
  await driver.tableExists("products");
  await driver.tableHasColumn("products", "id", "INTEGER");
  await driver.tableHasColumn("products", "category", "TEXT");
  await driver.tableHasColumn("products", "name", "TEXT");
  await driver.tableHasColumn("products", "price", "REAL");

  // Verify the composite index exists
  await driver.indexExists("products", "idx_products_category_name");

  // Verify the index columns
  await driver.indexHasColumns("products", "idx_products_category_name", ["category", "name"]);
}
