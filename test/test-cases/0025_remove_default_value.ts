export const description = "remove column default value";

export const current = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'unnamed'
  );
`;

export const next = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;
