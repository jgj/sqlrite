export const description = "create an index on a table";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL
  );

  CREATE INDEX idx_users_email ON users(email);
`;
