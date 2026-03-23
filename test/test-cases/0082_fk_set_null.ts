export const description = "foreign key with SET NULL action";

export const current = "";

export const next = `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
  );
`;
