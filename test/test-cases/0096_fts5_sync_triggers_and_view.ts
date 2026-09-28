export const description = "external-content FTS5 table with sync triggers and a view";

// The standard external-content setup: triggers on the content table keep the
// index in sync, and a view reads from the index
const triggers = `
  CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
  CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts (documents_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
  END;
  CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts (documents_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO documents_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
`;

export const current = `
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE documents_fts USING fts5(title, body, content=documents, content_rowid=id);
  ${triggers}
  CREATE VIEW documents_search AS SELECT rowid AS id, title FROM documents_fts;

  INSERT INTO documents (id, title, body) VALUES (1, 'hello', 'world'), (2, 'running', 'fast');
`;

export const next = `
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0
  );

  CREATE VIRTUAL TABLE documents_fts USING fts5(
    title, body, content=documents, content_rowid=id, tokenize='porter unicode61'
  );
  ${triggers}
  CREATE VIEW documents_search AS SELECT rowid AS id, title, body FROM documents_fts;
`;
