export const description =
  "a view the desired schema removes is dropped before its table is recreated";

// The recreate renames the new table into place, and every ALTER TABLE ...
// RENAME fails while a view reads a table that does not exist at that moment
export const current = `
  CREATE TABLE p (id INTEGER PRIMARY KEY, body TEXT);
  CREATE TABLE s (id INTEGER PRIMARY KEY, body TEXT);
  CREATE VIEW v AS SELECT p.id FROM p;
  CREATE VIEW w AS SELECT p.id, s.body FROM p JOIN s ON s.id = p.id;
`;

export const next = `
  CREATE TABLE p (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
  CREATE TABLE s (id INTEGER PRIMARY KEY, body TEXT);
`;
