export const description = "table with composite unique constraint";

export const current = "";

export const next = `
  CREATE TABLE memberships (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    UNIQUE (user_id, group_id)
  );
`;
