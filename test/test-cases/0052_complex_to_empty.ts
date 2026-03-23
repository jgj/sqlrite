export const description = "complex schema to empty database";

export const current = `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id)
  );

  CREATE INDEX idx_products_category ON products(category_id);

  CREATE VIEW all_products AS
    SELECT p.id, p.name, c.name as category
    FROM products p
    JOIN categories c ON p.category_id = c.id;
`;

export const next = "";
