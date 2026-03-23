export const description = "drop existing table";

export const current = `
  CREATE TABLE temp_users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export const next = "";
