export const description = "table recreation preserves data with generated columns";

export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    total REAL GENERATED ALWAYS AS (price * quantity) STORED
  );
`;

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price REAL NOT NULL CHECK (price > 0),
    quantity INTEGER NOT NULL,
    total REAL GENERATED ALWAYS AS (price * quantity) STORED
  );
`;
