export const description = "cosmetically different but equivalent FTS5 definitions";

// Quoting, option-name case, whitespace, option order, prefix spellings and
// tokenizer defaults differ; the definitions are equivalent, so nothing may
// change (also with virtual tables managed, see test/fts5.test.ts)
export const expectNoStatements = true;

export const current = `
  CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content='docs', content_rowid='id', tokenize='porter unicode61');
  CREATE VIRTUAL TABLE notes USING fts5(title, body UNINDEXED, prefix='2 3', detail=column);
  CREATE VIRTUAL TABLE tmp_tags USING fts5(label, content='', tokenize='unicode61 remove_diacritics 1');
  ALTER TABLE tmp_tags RENAME TO tags;

  INSERT INTO notes (title, body) VALUES ('hello', 'world');
`;

export const next = `
  CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  create virtual table if not exists docs_fts using FTS5 (
    "title",
    [body],
    TOKENIZE = porter,
    CONTENT = "DOCS",
    Content_Rowid = ID
  );
  CREATE VIRTUAL TABLE notes USING fts5(\`title\`, body "unindexed", DETAIL='COLUMN', prefix=3, PREFIX=2);
  CREATE VIRTUAL TABLE tags USING fts5(label, content="");
`;
