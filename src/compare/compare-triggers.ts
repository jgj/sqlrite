import type { Trigger } from "../introspection-result";
import { toMapByName } from "../utils";
import { normalizeSql } from "./normalize-sql";
import type { Diff, Modified } from "./types";

export function compareTriggers(current: Trigger[], desired: Trigger[]): Diff<Trigger> {
  const curr = toMapByName(current);
  const next = toMapByName(desired);

  const added: Trigger[] = [];
  const removed: Trigger[] = [];
  const modified: Modified<Trigger>[] = [];

  for (const trigger of desired) {
    const existing = curr.get(trigger.name);
    if (!existing) {
      added.push(trigger);
      continue;
    }

    const changes = hasTriggerLevelDifferences(existing, trigger);
    if (changes.length > 0) {
      modified.push({ current: existing, desired: trigger, changes });
    }
  }

  for (const trigger of current) {
    if (!next.has(trigger.name)) {
      removed.push(trigger);
    }
  }

  return { added, removed, modified };
}

function hasTriggerLevelDifferences(current: Trigger, desired: Trigger) {
  const changes: (keyof Trigger)[] = [];

  if (current.table !== desired.table) changes.push("table");
  if (normalizeSql(current.sql) !== normalizeSql(desired.sql)) changes.push("sql");

  return changes;
}
