export const description = "regular table changes work alongside virtual tables";

export const current = `
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE documents_fts USING fts5(title, content=documents, content_rowid=id);
`;

export const next = `
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT ''
  );

  CREATE VIRTUAL TABLE documents_fts USING fts5(title, content=documents, content_rowid=id);
`;
