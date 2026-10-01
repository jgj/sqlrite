export const description = "drop a column and change another column's collation in the same change";

// DROP COLUMN alone would leave the collation unchanged, so the table is recreated
export const current = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    a TEXT,
    b TEXT
  );
`;

export const next = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    a TEXT COLLATE NOCASE
  );
`;
