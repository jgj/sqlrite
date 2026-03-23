export const description = "add new table while dropping another";

export const current = `
  CREATE TABLE old_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE new_config (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;
