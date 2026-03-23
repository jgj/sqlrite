export const description = "modify both parent and child FK tables simultaneously";

export const current = `
  CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES authors(id),
    title TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) > 0)
  );

  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    isbn TEXT
  );
`;
