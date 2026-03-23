export const description = "table recreation preserves existing indexes";

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
    email TEXT NOT NULL CHECK (length(email) > 0)
  );

  CREATE INDEX idx_users_email ON users(email);
`;
