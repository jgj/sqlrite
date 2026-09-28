export const description = "FTS5 table is renamed along with the trigger and view that use it";

export const current = `
  CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT);
  CREATE VIRTUAL TABLE messages_fts USING fts5(body, tokenize=porter);
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, body) VALUES (new.id, new.body);
  END;
  CREATE VIEW recent_matches AS SELECT rowid AS id, body FROM messages_fts;

  INSERT INTO messages (id, body) VALUES (1, 'running late'), (2, 'on my way');
`;

export const next = `
  CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT);
  CREATE VIRTUAL TABLE message_search USING fts5(body, tokenize=porter);
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO message_search (rowid, body) VALUES (new.id, new.body);
  END;
  CREATE VIEW recent_matches AS SELECT rowid AS id, body FROM message_search;
`;
