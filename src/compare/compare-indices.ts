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

    const changes: (keyof Index)[] = [];
    for (const key of Object.keys(index) as (keyof Index)[]) {
      if (index[key] !== existing[key]) {
        changes.push(key);
      }
    }

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
