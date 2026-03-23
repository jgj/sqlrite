export const description = "change composite primary key columns";

export const current = `
  CREATE TABLE event_tags (
    event_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (event_id, tag_id)
  );
`;

export const next = `
  CREATE TABLE event_tags (
    event_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (event_id, tag_id, version)
  );
`;
