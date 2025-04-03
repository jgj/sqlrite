import { type } from "arktype";

const boolString = type("boolean|'true'|'false'").pipe((val) => {
  if (typeof val === "boolean") return val;
  return val === "true";
});

const numberString = type("string|number").pipe((val) => {
  if (typeof val === "number") return val;
  return Number(val);
});

const nullString = type("'null'|null").pipe((val) => {
  return null;
});

const table = type({
  type: '"table"',
  name: "string",
  sql: "string",
});

const columnPrecision = type({
  precision: numberString,
  scale: numberString,
}).or(nullString);

const column = type({
  type: '"column"',
  name: "string",
  table: "string",
  data_type: "string",
  ordinal_position: "number",
  nullable: boolString,
  character_maximum_length: numberString.or("null"),
  precision: columnPrecision,
  default: "string",
});

const index = type({
  type: '"index"',
  name: "string",
  table: "string",
  column: "string",
  unique: boolString,
  sql: "string|null",
});

const foreign_key = type({
  type: '"foreign_key"',
  name: "string",
  table: "string",
  column: "string",
  referenced_table: "string",
  referenced_column: "string",
  on_update: "string",
  on_delete: "string",
  definition: "string",
});

const primary_key = type({
  type: '"primary_key"',
  table: "string",
  column: "string",
  field_count: "number",
  definition: "string",
});

const trigger = type({
  type: '"trigger"',
  name: "string",
  table: "string",
  sql: "string",
});

const schema = type({
  tables: table.array(),
  columns: column.array(),
  indices: index.array(),
  foreign_keys: foreign_key.array(),
  primary_keys: primary_key.array(),
  triggers: trigger.array(),
});

export type IntrospectionResult = typeof schema.infer;

export function parseIntrospectionResult(data: unknown) {
  if (typeof data === "string") {
    return schema.assert(JSON.parse(data));
  }
  return schema.assert(data);
}
