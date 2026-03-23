export const description = "column with COLLATE NOCASE";

export const current = "";

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE
  );
`;
