export const description = "table with both STRICT and WITHOUT ROWID";

export const current = "";

export const next = `
  CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;
`;
