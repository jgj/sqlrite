export const description = "multiple simultaneous schema changes";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    body TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id)
  );
`;
