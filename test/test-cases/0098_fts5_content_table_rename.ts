export const description = "content table of an FTS5 index is renamed";

// SQLite does not update content= when the content table is renamed; with
// virtual tables managed the index is recreated with the desired content=
export const current = `
  CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  CREATE VIRTUAL TABLE search USING fts5(title, body, content=posts, content_rowid=id);
  CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO search (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;

  INSERT INTO posts (id, title, body) VALUES (1, 'hello', 'world');
`;

export const next = `
  CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  CREATE VIRTUAL TABLE search USING fts5(title, body, content=articles, content_rowid=id);
  CREATE TRIGGER posts_ai AFTER INSERT ON articles BEGIN
    INSERT INTO search (rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
`;
