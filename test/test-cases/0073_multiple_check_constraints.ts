export const description = "table with multiple check constraints";

export const current = "";

export const next = `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) > 0),
    price REAL NOT NULL CHECK (price >= 0),
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    CHECK (price * quantity <= 1000000)
  );
`;
