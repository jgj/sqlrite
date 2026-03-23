export const description = "create STRICT table";

export const current = "";

export const next = `
  CREATE TABLE measurements (
    id INTEGER PRIMARY KEY,
    value REAL NOT NULL,
    label TEXT NOT NULL
  ) STRICT;
`;
