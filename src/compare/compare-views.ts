import type { View } from "../introspection-result";
import { sameNames, toMapByName } from "../utils";
import { normalizeSql } from "./normalize-sql";
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

  // Compare the tables the view reads as a set of names: their order follows
  // sqlite_schema (creation order), which a recreate or the declaration order
  // changes, and a table may be named in another case on each side
  if (!sameNames(current.tables, desired.tables)) {
    changes.push("tables");
  }

  return changes;
}
