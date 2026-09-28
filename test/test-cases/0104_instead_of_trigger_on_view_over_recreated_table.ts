export const description =
  "a new INSTEAD OF trigger on a view over a recreated table is created after the view";

// The recreate of t drops the view v and puts it back; the trigger on v can
// only be created once v exists again
export const current = `
  CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE log (msg TEXT);
  CREATE VIEW v AS SELECT id, name FROM t;
  INSERT INTO t (id, name) VALUES (1, 'a');
`;

export const next = `
  CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE log (msg TEXT);
  CREATE VIEW v AS SELECT id, name FROM t;
  CREATE TRIGGER v_ins INSTEAD OF INSERT ON v BEGIN
    INSERT INTO t (id, name) VALUES (NEW.id, NEW.name);
  END;
`;
