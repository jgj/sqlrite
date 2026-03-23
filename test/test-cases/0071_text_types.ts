export const description = "various text column types";

export const current = "";

export const next = `
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    summary VARCHAR(500),
    code CHAR(10)
  );
`;
