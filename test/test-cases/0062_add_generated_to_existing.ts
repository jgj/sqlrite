export const description = "add generated column to existing table";

export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL
  );
`;

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    total REAL GENERATED ALWAYS AS (price * quantity) STORED
  );
`;
