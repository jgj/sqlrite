export const description = "create table with default values";

export const current = "";

export const next = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    count INTEGER DEFAULT 0,
    name TEXT DEFAULT 'unnamed',
    rate REAL DEFAULT 1.5
  );
`;
