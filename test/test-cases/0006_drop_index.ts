export const description = "drop an index";

export const current = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE INDEX idx_items_name ON items(name);
`;

export const next = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;
