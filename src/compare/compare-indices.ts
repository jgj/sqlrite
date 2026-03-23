import type { Index } from "~/introspection-result";
import { toMapByName } from "~/utils";
import type { Diff, Modified } from "./types";

export function compareIndices(current: Index[], desired: Index[]): Diff<Index> {
  const curr = toMapByName(current);
  const next = toMapByName(desired);

  const added: Index[] = [];
  const removed: Index[] = [];
  const modified: Modified<Index>[] = [];

  for (const index of desired) {
    const existing = curr.get(index.name);
    if (!existing) {
      added.push(index);
      continue;
    }

    const changes = getIndexChanges(existing, index);
    if (changes.length > 0) {
      modified.push({
        current: existing,
        desired: index,
        changes,
      });
    }
  }

  for (const index of current) {
    if (!next.has(index.name)) {
      removed.push(index);
    }
  }

  return { added, removed, modified };
}

function getIndexChanges(current: Index, desired: Index): (keyof Index)[] {
  const changes: (keyof Index)[] = [];

  if (current.table !== desired.table) changes.push("table");
  if (current.unique !== desired.unique) changes.push("unique");

  // Compare columns arrays by value, not reference
  if (
    current.columns.length !== desired.columns.length ||
    current.columns.some((col, i) => col !== desired.columns[i])
  ) {
    changes.push("columns");
  }

  // Compare SQL with normalization to handle whitespace/quoting differences
  if (normalizeSql(current.sql) !== normalizeSql(desired.sql)) {
    changes.push("sql");
  }

  return changes;
}

function normalizeSql(sql: string | null): string | null {
  if (sql === null) return null;
  return sql
    .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
