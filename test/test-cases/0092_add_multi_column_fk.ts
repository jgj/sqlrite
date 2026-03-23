export const description = "add multi-column foreign key to existing table";

export const current = `
  CREATE TABLE parent (
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );

  CREATE TABLE child (
    id INTEGER PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL
  );
`;

export const next = `
  CREATE TABLE parent (
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );

  CREATE TABLE child (
    id INTEGER PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    FOREIGN KEY (x, y) REFERENCES parent(a, b)
  );
`;
