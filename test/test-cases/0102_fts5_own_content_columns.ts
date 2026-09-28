export const description =
  "own-content FTS5 table gains and loses columns, with a trigger and a view";

export const current = `
  CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, draft UNINDEXED);
  CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
  CREATE VIEW note_titles AS SELECT rowid AS id, title FROM notes_fts;

  INSERT INTO notes (id, title, body) VALUES (3, 'hello', 'world'), (8, 'running', 'shoes');
`;

export const next = `
  CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tags, tokenize='porter');
  CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
  CREATE VIEW note_titles AS SELECT rowid AS id, title FROM notes_fts;
`;
