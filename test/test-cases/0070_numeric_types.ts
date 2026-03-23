export const description = "various numeric column types";

export const current = "";

export const next = `
  CREATE TABLE measurements (
    id INTEGER PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    amount REAL NOT NULL,
    score NUMERIC NOT NULL,
    flag BOOLEAN NOT NULL DEFAULT 0
  );
`;
