export const description = "table recreation preserves indexes with foreign keys";

export const current = `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    price REAL NOT NULL
  );

  CREATE INDEX idx_products_category ON products(category_id);
  CREATE INDEX idx_products_name ON products(name);
`;

export const next = `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    price REAL NOT NULL CHECK (price > 0)
  );

  CREATE INDEX idx_products_category ON products(category_id);
  CREATE INDEX idx_products_name ON products(name);
`;
