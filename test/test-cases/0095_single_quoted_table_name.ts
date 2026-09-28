export const description = "table whose name is written in single quotes is managed like any other";

export const current = "";

export const next = `
  CREATE TABLE 'quoted_user' (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;
