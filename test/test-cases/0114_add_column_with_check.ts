export const description = "add a column with a CHECK constraint and a collation";

// ADD COLUMN writes the column as the desired CREATE TABLE declares it
export const current = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY
  );
`;

export const next = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    code TEXT COLLATE NOCASE CHECK (code <> '')
  );
`;
