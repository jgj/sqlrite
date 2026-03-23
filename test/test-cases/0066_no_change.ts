export const description = "no schema changes produces empty migration";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );

  CREATE INDEX idx_users_email ON users(email);
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );

  CREATE INDEX idx_users_email ON users(email);
`;
