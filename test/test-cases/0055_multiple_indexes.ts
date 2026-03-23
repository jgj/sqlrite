export const description = "add multiple indexes to table";

export const current = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT
  );
`;

export const next = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT
  );

  CREATE INDEX idx_events_type ON events(type);
  CREATE INDEX idx_events_user ON events(user_id);
  CREATE INDEX idx_events_created ON events(created_at);
`;
