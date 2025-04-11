import { compareColumns } from "./compare/compare-columns";
import { compareForeignKeys } from "./compare/compare-foreign-keys";
import { compareIndices } from "./compare/compare-indices";
import { comparePrimaryKeys } from "./compare/compare-primary-keys";
import { compareTables } from "./compare/compare-tables";
import { compareTriggers } from "./compare/compare-triggers";
import { compareViews } from "./compare/compare-views";
import type { SchemaDiff } from "./compare/types";
import type { IntrospectionResult } from "./introspection-result";

/**
 * Produce diffs - this only makes comparisons, it does not opine on how the changes should
 * be expressed in SQL
 */
export function compareSchema(
  current: IntrospectionResult,
  desired: IntrospectionResult,
): SchemaDiff {
  const table = compareTables(current.tables, desired.tables);
  const column = compareColumns(current.columns, desired.columns);
  const index = compareIndices(current.indices, desired.indices);
  const foreign_key = compareForeignKeys(current.foreign_keys, desired.foreign_keys);
  const primary_key = comparePrimaryKeys(current.primary_keys, desired.primary_keys);
  const trigger = compareTriggers(current.triggers, desired.triggers);
  const view = compareViews(current.views, desired.views);
  return { table, column, index, foreign_key, primary_key, trigger, view, current, desired };
}
