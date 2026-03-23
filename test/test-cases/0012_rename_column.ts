export const description = "rename column in existing table";

export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    old_name TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;
