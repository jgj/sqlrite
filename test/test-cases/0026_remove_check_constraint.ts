export const description = "remove check constraint from column";

export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price INTEGER NOT NULL CHECK (price >= 0)
  );
`;

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price INTEGER NOT NULL
  );
`;
