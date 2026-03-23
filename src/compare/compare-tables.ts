import type { Table } from "~/introspection-result";
import { toMapByName } from "~/utils";
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
  return normalizeTableSql(current) !== normalizeTableSql(desired);
}

// Normalize CREATE TABLE SQL for comparison by removing cosmetic differences
// that don't affect the schema semantics.
//
// SQLite's ALTER TABLE ADD COLUMN appends columns to the stored SQL in a way
// that differs from a fresh CREATE TABLE — e.g. different whitespace around
// commas, quoted identifiers, trailing spaces before closing parens.
function normalizeTableSql(sql: string): string {
  return (
    sql
      // Remove double-quoted identifiers (SQLite adds these on ALTER TABLE ADD COLUMN)
      .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g, "$1")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      // Normalize space around commas: ensure exactly ", "
      .replace(/\s*,\s*/g, ", ")
      // Normalize space inside parens: "( " -> "(", " )" -> ")"
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim()
  );
}
