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
