import type { TestDriver } from "@/test-driver";

export const description = "create table with composite primary key";

export const current = "";

export const next = `
  CREATE TABLE order_items (
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    PRIMARY KEY (order_id, product_id)
  );
`;

export async function verify(driver: TestDriver) {
  driver.ddl.expectStatementCount(1);
  driver.ddl.expectStatement("CREATE TABLE order_items");

  await driver.tableExists("order_items");
  await driver.tableHasColumn("order_items", "order_id", "INTEGER");
  await driver.tableHasColumn("order_items", "product_id", "INTEGER");
  await driver.tableHasColumn("order_items", "quantity", "INTEGER");
  await driver.tableHasColumn("order_items", "price", "REAL");

  await driver.columnHasConstraint("order_items", "order_id", "notnull");
  await driver.columnHasConstraint("order_items", "product_id", "notnull");
  await driver.columnHasConstraint("order_items", "quantity", "notnull");
  await driver.columnHasConstraint("order_items", "price", "notnull");

  await driver.tablePrimaryKeyColumns("order_items", ["order_id", "product_id"]);
}
