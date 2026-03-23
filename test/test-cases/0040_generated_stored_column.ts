export const description = "create table with stored generated column";

export const current = "";

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price REAL NOT NULL,
    tax_rate REAL NOT NULL DEFAULT 0.1,
    total REAL GENERATED ALWAYS AS (price * (1 + tax_rate)) STORED
  );
`;
