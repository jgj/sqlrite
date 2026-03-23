export const description = "create expression-based index";

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

  CREATE INDEX idx_users_email_lower ON users(lower(email));
`;
