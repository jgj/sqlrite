import type { View } from "~/introspection-result";
import { toMapByName } from "~/utils";
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

    const changes: (keyof View)[] = [];
    for (const key of Object.keys(view) as (keyof View)[]) {
      if (view[key] !== existing[key]) {
        changes.push(key);
      }
    }

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
