export const description =
  "an INSTEAD OF trigger on a view that reads a changed view survives the migration";

// v1 changes, so v2 (which reads v1) is dropped and put back; SQLite drops the
// triggers on a view together with the view, so v2_ins has to be put back too
export const current = `
  CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
  CREATE VIEW v1 AS SELECT id, name FROM t;
  CREATE VIEW v2 AS SELECT id, name FROM v1;
  CREATE TRIGGER v2_ins INSTEAD OF INSERT ON v2 BEGIN
    INSERT INTO t (id, name) VALUES (NEW.id, NEW.name);
  END;
`;

export const next = `
  CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
  CREATE VIEW v1 AS SELECT id, name, 1 AS one FROM t;
  CREATE VIEW v2 AS SELECT id, name FROM v1;
  CREATE TRIGGER v2_ins INSTEAD OF INSERT ON v2 BEGIN
    INSERT INTO t (id, name) VALUES (NEW.id, NEW.name);
  END;
`;
