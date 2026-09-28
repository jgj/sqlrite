export const description = "content table of an FTS5 index is recreated (no INTEGER PRIMARY KEY)";

// The recreate renumbers the content table's rowids; with virtual tables
// managed the index is rebuilt afterwards
export const current = `
  CREATE TABLE notes (title TEXT, body TEXT);
  CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content=notes);
  CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
  END;

  INSERT INTO notes (rowid, title, body) VALUES (1, 'gone', ''), (2, 'hello', 'world'), (3, 'dog', 'lazy');
  DELETE FROM notes WHERE rowid = 1;
  INSERT INTO notes_fts (notes_fts) VALUES ('rebuild');
`;

export const next = `
  CREATE TABLE notes (title TEXT NOT NULL, body TEXT);
  CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content=notes);
  CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
  END;
`;
