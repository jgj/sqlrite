export const description = "modify index columns";

export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL
  );

  CREATE INDEX idx_products ON products(name);
`;

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL
  );

  CREATE INDEX idx_products ON products(category, name);
`;
