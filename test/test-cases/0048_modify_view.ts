export const description = "modify view definition";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE VIEW active_users AS SELECT id, name FROM users WHERE active = 1;
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE VIEW active_users AS SELECT id, name, email FROM users WHERE active = 1;
`;
