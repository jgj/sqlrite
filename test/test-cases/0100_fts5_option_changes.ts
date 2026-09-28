export const description = "FTS5 tables whose options change";

// Only options every driver accepts (libsql 3.45 has no contentless_unindexed
// or locale)
export const current = `
  CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  CREATE VIRTUAL TABLE with_prefix USING fts5(title, prefix='2 3');
  CREATE VIRTUAL TABLE with_detail USING fts5(title, body);
  CREATE VIRTUAL TABLE with_tokenizer USING fts5(title);
  CREATE VIRTUAL TABLE contentless USING fts5(title, content='');
  CREATE VIRTUAL TABLE external USING fts5(title, content=docs, content_rowid=id);
  CREATE VIRTUAL TABLE own_to_external USING fts5(title, body);

  INSERT INTO docs (id, title, body) VALUES (1, 'hello', 'world');
  INSERT INTO with_prefix (rowid, title) VALUES (5, 'quick');
  INSERT INTO with_detail (rowid, title, body) VALUES (6, 'brown', 'fox');
  INSERT INTO with_tokenizer (rowid, title) VALUES (7, 'jumps');
  INSERT INTO contentless (rowid, title) VALUES (8, 'over');
  INSERT INTO own_to_external (rowid, title, body) VALUES (9, 'lazy', 'dog');
`;

export const next = `
  CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
  CREATE VIRTUAL TABLE with_prefix USING fts5(title, prefix='2 4');
  CREATE VIRTUAL TABLE with_detail USING fts5(title, body, detail=none, columnsize=0);
  CREATE VIRTUAL TABLE with_tokenizer USING fts5(title, tokenize='trigram');
  CREATE VIRTUAL TABLE contentless USING fts5(title, content='', contentless_delete=1);
  CREATE VIRTUAL TABLE external USING fts5(title, body, content=docs, content_rowid=id, tokendata=1);
  CREATE VIRTUAL TABLE own_to_external USING fts5(title, body, content=docs, content_rowid=id);
`;
