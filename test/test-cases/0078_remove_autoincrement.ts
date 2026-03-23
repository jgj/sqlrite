export const description = "remove autoincrement from primary key";

export const current = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;
