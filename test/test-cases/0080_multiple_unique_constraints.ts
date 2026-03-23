export const description = "table with multiple unique constraints";

export const current = "";

export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    phone TEXT UNIQUE
  );
`;
