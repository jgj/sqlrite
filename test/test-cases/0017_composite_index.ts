export const description = "create composite index on multiple columns";

export const current = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL
  );
`;

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL
  );

  CREATE INDEX idx_products_category_name ON products(category, name);
`;
