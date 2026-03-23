export const description = "column with ON CONFLICT clause";

export const current = "";

export const next = `
  CREATE TABLE counters (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE ON CONFLICT REPLACE,
    value INTEGER NOT NULL DEFAULT 0
  );
`;
