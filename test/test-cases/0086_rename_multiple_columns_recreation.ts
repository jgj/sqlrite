export const description = "rename multiple columns during table recreation";

export const current = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    event_name TEXT NOT NULL,
    event_time TEXT NOT NULL,
    event_data TEXT
  );
`;

export const next = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload TEXT,
    CHECK (length(name) > 0)
  );
`;
