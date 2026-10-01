export const description = "add a column defaulting to CURRENT_TIMESTAMP to a table with rows";

// ALTER TABLE ADD COLUMN rejects CURRENT_TIMESTAMP as a non-constant default
export const current = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  INSERT INTO t (name) VALUES ('a');
`;

export const next = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;
