export const description = "columns with complex default expressions";

export const current = "";

export const next = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    uuid TEXT NOT NULL DEFAULT (hex(randomblob(16))),
    sequence INTEGER NOT NULL DEFAULT 0
  );
`;
