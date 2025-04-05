import type { PrimaryKey } from "~/introspection-result";
import { toMap } from "~/utils";
import type { Diff, Modified } from "./types";

export function comparePrimaryKeys(current: PrimaryKey[], desired: PrimaryKey[]): Diff<PrimaryKey> {
  const curr = toMap(current, "table");
  const next = toMap(desired, "table");

  const added: PrimaryKey[] = [];
  const removed: PrimaryKey[] = [];
  const modified: Modified<PrimaryKey>[] = [];

  for (const primaryKey of desired) {
    const existing = curr.get(primaryKey.table);
    if (!existing) {
      added.push(primaryKey);
      continue;
    }

    const changes: (keyof PrimaryKey)[] = [];
    for (const key of Object.keys(primaryKey) as (keyof PrimaryKey)[]) {
      if (primaryKey[key] !== existing[key]) {
        changes.push(key);
      }
    }

    if (changes.length > 0) {
      modified.push({
        current: existing,
        desired: primaryKey,
        changes,
      });
    }
  }

  for (const primaryKey of current) {
    if (!next.has(primaryKey.table)) {
      removed.push(primaryKey);
    }
  }

  return { added, removed, modified };
}
