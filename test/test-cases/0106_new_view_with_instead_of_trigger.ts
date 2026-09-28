export const description = "a new view and a new INSTEAD OF trigger on it are created in order";

export const current = `
  CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
`;

export const next = `
  CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
  CREATE VIEW v AS SELECT id, name FROM t;
  CREATE TRIGGER v_ins INSTEAD OF INSERT ON v BEGIN
    INSERT INTO t (id, name) VALUES (NEW.id, NEW.name);
  END;
`;
