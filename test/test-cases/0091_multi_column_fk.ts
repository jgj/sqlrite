export const description = "table with multi-column foreign key";

export const current = "";

export const next = `
  CREATE TABLE parent (
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    value TEXT,
    PRIMARY KEY (a, b)
  );

  CREATE TABLE child (
    id INTEGER PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    data TEXT,
    FOREIGN KEY (x, y) REFERENCES parent(a, b)
  );
`;
