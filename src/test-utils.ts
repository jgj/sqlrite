import { parseIntrospectionResult } from "./introspection-result";

export function getEmptyDatabaseSchema() {
  return parseIntrospectionResult({
    tables: [],
    columns: [],
    indices: [],
    foreign_keys: [],
    primary_keys: [],
    triggers: [],
  });
}
