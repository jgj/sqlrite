export const description = "modify trigger definition";

export const current = `
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TRIGGER log_user_insert
  AFTER INSERT ON users
  BEGIN
    INSERT INTO audit_log (action, timestamp) VALUES ('insert', datetime('now'));
  END;
`;

export const next = `
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TRIGGER log_user_insert
  AFTER INSERT ON users
  BEGIN
    INSERT INTO audit_log (action, timestamp) VALUES ('user_created', datetime('now'));
  END;
`;
