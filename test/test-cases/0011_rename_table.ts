export const description = "rename table";

export const current = `
  CREATE TABLE old_users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE new_users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;
