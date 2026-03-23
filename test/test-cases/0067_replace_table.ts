export const description = "drop table and create new one with same name but different schema";

export const current = `
  CREATE TABLE data (
    id INTEGER PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE data (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;
