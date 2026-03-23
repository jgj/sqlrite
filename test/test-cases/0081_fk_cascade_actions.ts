export const description = "foreign key with cascade actions";

export const current = "";

export const next = `
  CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE ON UPDATE CASCADE
  );
`;
