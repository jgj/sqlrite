export const description = "create WITHOUT ROWID table";

export const current = "";

export const next = `
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
`;
