export const description = "change check constraint expression";

export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price REAL NOT NULL CHECK (price >= 0)
  );
`;

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    price REAL NOT NULL CHECK (price > 0 AND price < 10000)
  );
`;
