import type { Table } from "../introspection-result";
import { sqlIdentifier, toMapByName } from "../utils";
import { replaceCreateTableName } from "../virtual-tables/parse";
import { normalizeSql } from "./normalize-sql";
import type { Diff, Modified } from "./types";

export function compareTables(current: Table[], desired: Table[]): Diff<Table> {
  const curr = toMapByName(current);
  const next = toMapByName(desired);

  const added: Table[] = [];
  const removed: Table[] = [];
  const modified: Modified<Table>[] = [];

  for (const table of desired) {
    if (!curr.has(table.name)) {
      added.push(table);
    }
  }

  for (const currentTable of current) {
    const desiredTable = next.get(currentTable.name);
    if (desiredTable) {
      if (hasTableLevelDifferences(canonicalName(currentTable), canonicalName(desiredTable))) {
        modified.push({ current: currentTable, desired: desiredTable, changes: ["sql"] });
      }
    } else {
      removed.push(currentTable);
    }
  }

  return { added, removed, modified };
}

// The table's name token may be written with any quoting, including single
// quotes (CREATE TABLE 'x'), which normalizeSql leaves alone as they also
// delimit strings. A recreate or rename stores it double-quoted.
function canonicalName(table: Table): string {
  try {
    return replaceCreateTableName(table.sql, sqlIdentifier(table.name));
  } catch {
    return table.sql;
  }
}

function hasTableLevelDifferences(current: string, desired: string): boolean {
  return normalizeSql(current) !== normalizeSql(desired);
}
