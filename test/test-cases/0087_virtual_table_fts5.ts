export const description = "schema with FTS5 virtual table is not broken";

export const current = "";

export const next = `
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE documents_fts USING fts5(title, body, content=documents, content_rowid=id);
`;
