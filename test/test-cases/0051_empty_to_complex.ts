export const description = "empty database to complex schema";

export const current = "";

export const next = `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT ''
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    price REAL NOT NULL CHECK (price > 0),
    in_stock INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX idx_products_category ON products(category_id);

  CREATE VIEW available_products AS
    SELECT p.id, p.name, c.name as category, p.price
    FROM products p
    JOIN categories c ON p.category_id = c.id
    WHERE p.in_stock = 1;
`;
