import type { View } from "../introspection-result";
import { toMapByName } from "../utils";
import type { Diff, Modified } from "./types";

export function compareViews(current: View[], desired: View[]): Diff<View> {
  const curr = toMapByName(current);
  const next = toMapByName(desired);

  const added: View[] = [];
  const removed: View[] = [];
  const modified: Modified<View>[] = [];

  for (const view of desired) {
    const existing = curr.get(view.name);
    if (!existing) {
      added.push(view);
      continue;
    }

    const changes = getViewChanges(existing, view);
    if (changes.length > 0) {
      modified.push({
        current: existing,
        desired: view,
        changes,
      });
    }
  }

  for (const view of current) {
    if (!next.has(view.name)) {
      removed.push(view);
    }
  }

  return { added, removed, modified };
}

function getViewChanges(current: View, desired: View): (keyof View)[] {
  const changes: (keyof View)[] = [];

  // Compare SQL with normalization
  if (normalizeSql(current.sql) !== normalizeSql(desired.sql)) {
    changes.push("sql");
  }

  // Compare tables arrays by value
  if (
    current.tables.length !== desired.tables.length ||
    current.tables.some((t, i) => t !== desired.tables[i])
  ) {
    changes.push("tables");
  }

  return changes;
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
