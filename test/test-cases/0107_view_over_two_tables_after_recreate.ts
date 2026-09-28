export const description =
  "a view over two tables is left alone once one of them is recreated (table order does not matter)";

// The recreate moves a after b in sqlite_schema, so the tables a view reads
// come back in another order; that alone is not a change to the view
export const current = `
  CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT);
  CREATE TABLE b (id INTEGER PRIMARY KEY, y TEXT);
  CREATE VIEW v AS SELECT a.x, b.y FROM a JOIN b ON a.id = b.id;
`;

export const next = `
  CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT NOT NULL);
  CREATE TABLE b (id INTEGER PRIMARY KEY, y TEXT);
  CREATE VIEW v AS SELECT a.x, b.y FROM a JOIN b ON a.id = b.id;
`;
