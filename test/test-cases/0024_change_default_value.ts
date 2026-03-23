export const description = "change column default value";

export const current = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active'
  );
`;

export const next = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'inactive'
  );
`;
