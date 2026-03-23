export const description = "add unique constraint";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
  );
`;
