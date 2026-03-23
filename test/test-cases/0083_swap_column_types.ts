export const description = "change multiple column types simultaneously";

export const current = `
  CREATE TABLE data (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    value INTEGER NOT NULL
  );
`;

export const next = `
  CREATE TABLE data (
    id INTEGER PRIMARY KEY,
    label INTEGER NOT NULL,
    value TEXT NOT NULL
  );
`;
