export const description = "schema with an R*Tree virtual table is not broken by its shadow tables";

export const current = `
  CREATE TABLE places (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`;

export const next = `
  CREATE TABLE places (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'poi'
  );

  CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX, minY, maxY);
`;
