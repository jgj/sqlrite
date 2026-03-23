export const description = "drop one index and add another";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL
  );

  CREATE INDEX idx_users_name ON users(name);
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL
  );

  CREATE INDEX idx_users_role ON users(role);
`;
