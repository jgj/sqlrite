export const description = "create table with no primary key";

export const current = "";

export const next = `
  CREATE TABLE logs (
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT
  );
`;
