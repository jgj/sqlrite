export const description = "create table with virtual generated column";

export const current = "";

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) VIRTUAL
  );
`;
