import type { Table } from "../introspection-result";
import { toMapByName } from "../utils";
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
      if (hasTableLevelDifferences(currentTable.sql, desiredTable.sql)) {
        modified.push({ current: currentTable, desired: desiredTable, changes: ["sql"] });
      }
    } else {
      removed.push(currentTable);
    }
  }

  return { added, removed, modified };
}

function hasTableLevelDifferences(current: string, desired: string): boolean {
  return normalizeSql(current) !== normalizeSql(desired);
}
