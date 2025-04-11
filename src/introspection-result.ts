import { type } from "arktype";

const boolString = type("boolean|'true'|'false'").pipe((val) => {
  if (typeof val === "boolean") return val;
  return val === "true";
});

const numberString = type("string|number|null").pipe((val) => {
  if (typeof val === "number") return val;
  if (typeof val === "string" && /\d+/.test(val)) return Number(val);
  if (val === "null" || val === null) return null;
  throw new TypeError("Not a numeric string");
});

const nullString = type("'null'|null").pipe((val) => {
  return null;
});

const table = type({
  type: '"table"',
  name: "string",
  sql: "string",
  views: "string[]",
  num_cols: "number",
});

export type Table = typeof table.infer;

const column = type({
  type: '"column"',
  name: "string",
  table: "string",
  data_type: "string",
  ordinal_position: "number",
  nullable: boolString,
  character_maximum_length: numberString,
  precision: type({
    precision: numberString,
    scale: numberString,
  }).or(nullString),
  default: "string",
});

export type Column = typeof column.infer;

const index = type({
  type: '"index"',
  name: "string",
  table: "string",
  columns: "string[]",
  unique: boolString,
  sql: "string|null",
});

export type Index = typeof index.infer;

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

export type ForeignKey = typeof foreign_key.infer;

const primary_key = type({
  type: '"primary_key"',
  table: "string",
  column: "string",
  field_count: "number",
  definition: "string",
});

export type PrimaryKey = typeof primary_key.infer;

const trigger = type({
  type: '"trigger"',
  name: "string",
  table: "string",
  sql: "string",
});

export type Trigger = typeof trigger.infer;

const view = type({
  type: '"view"',
  name: "string",
  sql: "string",
  tables: "string[]",
});

export type View = typeof view.infer;

const schema = type({
  tables: table.array(),
  columns: column.array(),
  indices: index.array(),
  foreign_keys: foreign_key.array(),
  primary_keys: primary_key.array(),
  triggers: trigger.array(),
  views: view.array(),
});

export type IntrospectionResult = typeof schema.infer;

export type IntrospectionObject = Table | Column | Index | ForeignKey | PrimaryKey | Trigger | View;
export type IntrospectionObjectType = IntrospectionObject["type"];

export function parseIntrospectionResult(data: unknown) {
  if (typeof data === "string") {
    return schema.assert(JSON.parse(data));
  }
  return schema.assert(data);
}
