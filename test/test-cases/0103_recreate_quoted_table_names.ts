export const description =
  "tables whose names are written in single quotes, brackets or backticks are recreated";

// A recreate builds a temp table from the desired CREATE TABLE statement, so
// the name token has to be replaced whatever its quoting
export const current = `
  CREATE TABLE 'q' (id INTEGER PRIMARY KEY, a TEXT);
  CREATE TABLE [b] (id INTEGER PRIMARY KEY, a TEXT);
  CREATE TABLE \`t\` (id INTEGER PRIMARY KEY, a TEXT);
  INSERT INTO q VALUES (1, 'x');
  INSERT INTO b VALUES (1, 'y');
  INSERT INTO t VALUES (1, 'z');
`;

export const next = `
  CREATE TABLE 'q' (id INTEGER PRIMARY KEY, a TEXT NOT NULL);
  CREATE TABLE [b] (id INTEGER PRIMARY KEY, a TEXT NOT NULL);
  CREATE TABLE \`t\` (id INTEGER PRIMARY KEY, a TEXT NOT NULL);
`;
