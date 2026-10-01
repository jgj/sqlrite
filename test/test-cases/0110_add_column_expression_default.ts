export const description = "add a NOT NULL column with an expression default to a table with rows";

// ALTER TABLE ADD COLUMN rejects a non-constant default, so the table is recreated
export const current = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  ) STRICT;
  INSERT INTO t (name) VALUES ('a');
`;

export const next = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT;
`;
