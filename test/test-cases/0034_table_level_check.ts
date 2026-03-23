export const description = "table-level CHECK constraint";

export const current = "";

export const next = `
  CREATE TABLE ranges (
    id INTEGER PRIMARY KEY,
    low INTEGER NOT NULL,
    high INTEGER NOT NULL,
    CHECK (low < high)
  );
`;
