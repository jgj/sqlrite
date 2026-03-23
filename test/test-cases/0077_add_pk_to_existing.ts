export const description = "add primary key to table that had none";

export const current = `
  CREATE TABLE logs (
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL
  );
`;
