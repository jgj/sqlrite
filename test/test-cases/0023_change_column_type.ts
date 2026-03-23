export const description = "change column data type";

export const current = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    quantity TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    quantity INTEGER NOT NULL
  );
`;
