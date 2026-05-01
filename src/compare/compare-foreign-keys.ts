import type { ForeignKey } from "../introspection-result";
import { toMapByName } from "../utils";
import type { Diff, Modified } from "./types";

export function compareForeignKeys(current: ForeignKey[], desired: ForeignKey[]): Diff<ForeignKey> {
  const curr = toMapByName(current);
  const next = toMapByName(desired);

  const added: ForeignKey[] = [];
  const removed: ForeignKey[] = [];
  const modified: Modified<ForeignKey>[] = [];

  for (const foreignKey of desired) {
    const existing = curr.get(foreignKey.name);
    if (!existing) {
      added.push(foreignKey);
      continue;
    }

    const changes: (keyof ForeignKey)[] = [];
    for (const key of Object.keys(foreignKey) as (keyof ForeignKey)[]) {
      if (foreignKey[key] !== existing[key]) {
        changes.push(key);
      }
    }

    if (changes.length > 0) {
      modified.push({
        current: existing,
        desired: foreignKey,
        changes,
      });
    }
  }

  for (const foreignKey of current) {
    if (!next.has(foreignKey.name)) {
      removed.push(foreignKey);
    }
  }

  return { added, removed, modified };
}
