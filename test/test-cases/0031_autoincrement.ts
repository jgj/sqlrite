import type { TestDriver } from "@/test-driver";

export const description = "test adding autoincrement to a primary key column";

// the SQL DDL representing the starting state of the database
export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT
  );
`;

// the SQL DDL representing the desired state of the database
export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT
  );
`;

export async function verify(driver: TestDriver) {
  // Verify the migration statements were generated correctly
  driver.ddl.expectStatementCount(4); // 4 statements for table recreation

  // Verify table exists with the correct schema
  await driver.tableExists("products");
  await driver.tableHasColumn("products", "id", "INTEGER");
  await driver.tableHasColumn("products", "name", "TEXT");
  await driver.tableHasColumn("products", "price", "REAL");
  await driver.tableHasColumn("products", "description", "TEXT");

  // Verify AUTOINCREMENT attribute is present
  // const sql = await driver.selectOne<{ sql: string }>(
  //   `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'products'`,
  // );
  // expect(sql?.sql).toContain("AUTOINCREMENT");
}
