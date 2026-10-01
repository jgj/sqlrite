export const description = "add a column and a table CHECK constraint in the same change";

// ADD COLUMN alone would leave the CHECK out, so the table is recreated
export const current = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    a TEXT
  );
  INSERT INTO t (a) VALUES ('x');
`;

export const next = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    a TEXT,
    b TEXT,
    CHECK (length(a) > 0)
  );
`;
