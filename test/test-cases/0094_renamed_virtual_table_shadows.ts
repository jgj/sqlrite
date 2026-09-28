export const description = "shadow tables of renamed virtual tables are left alone";

// After ALTER TABLE ... RENAME, SQLite rewrites the shadow tables' SQL with
// double-quoted names, which the old string-based shadow filter missed
export const current = `
  CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
  CREATE VIRTUAL TABLE notes_fts_old USING fts5(body);
  CREATE VIRTUAL TABLE areas_old USING rtree(id, minX, maxX);
  ALTER TABLE notes_fts_old RENAME TO notes_fts;
  ALTER TABLE areas_old RENAME TO areas;
`;

export const next = `
  CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
  CREATE VIRTUAL TABLE notes_fts USING fts5(body);
  CREATE VIRTUAL TABLE areas USING rtree(id, minX, maxX);
`;
