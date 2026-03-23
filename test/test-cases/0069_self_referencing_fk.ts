export const description = "table with self-referencing foreign key";

export const current = "";

export const next = `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id)
  );
`;
