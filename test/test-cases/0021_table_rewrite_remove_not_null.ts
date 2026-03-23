export const description = "remove NOT NULL constraint via table recreation";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    bio TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    bio TEXT
  );
`;
