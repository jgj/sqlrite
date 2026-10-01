export const description =
  "recreate drops and adds look-alike columns without copying data between them";

// Without renameColumns, "type" and "fingerprint" are dropped and "status" and
// "note" added. Copying "type" into "status" would fail its CHECK constraint.
export const current = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('defect', 'feature')),
    fingerprint TEXT,
    title TEXT NOT NULL
  ) STRICT;
  INSERT INTO t (type, fingerprint, title) VALUES ('defect', 'abc123', 'one');
`;

export const next = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    note TEXT
  ) STRICT;
`;
