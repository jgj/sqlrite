export const description = "create partial index with WHERE clause";

export const current = `
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    total REAL NOT NULL
  );
`;

export const next = `
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    total REAL NOT NULL
  );

  CREATE INDEX idx_pending_orders ON orders(total) WHERE status = 'pending';
`;
