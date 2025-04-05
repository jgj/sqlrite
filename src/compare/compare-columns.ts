import type { Column } from "~/introspection-result";
import { toMapBy, getColName } from "~/utils";
import type { Diff, Modified } from "./types";

export function compareColumns(current: Column[], desired: Column[]): Diff<Column> {
  const curr = toMapBy(current, getColName);
  const next = toMapBy(desired, getColName);

  const added: Column[] = [];
  const removed: Column[] = [];
  const modified: Modified<Column>[] = [];

  for (const column of desired) {
    const existing = curr.get(getColName(column));
    if (!existing) {
      added.push(column);
      continue;
    }

    const changes = hasColumnLevelDifferences(existing, column);
    if (changes.length > 0) {
      modified.push({ current: existing, desired: column, changes });
    }
  }

  for (const column of current) {
    if (!next.has(getColName(column))) {
      removed.push(column);
    }
  }

  return { added, removed, modified };
}

function hasColumnLevelDifferences(current: Column, desired: Column) {
  const changes: (keyof Column)[] = [];

  if (current.data_type !== desired.data_type) changes.push("data_type");
  if (current.nullable !== desired.nullable) changes.push("nullable");
  if (current.ordinal_position !== desired.ordinal_position) changes.push("ordinal_position");
  if (current.default !== desired.default) changes.push("default");

  if (current.precision === null && desired.precision !== null) {
    changes.push("precision");
  } else if (current.precision !== null && desired.precision === null) {
    changes.push("precision");
  } else if (current.precision !== null && desired.precision !== null) {
    if (
      current.precision.precision !== desired.precision.precision ||
      current.precision.scale !== desired.precision.scale
    ) {
      changes.push("precision");
    }
  }

  if (current.character_maximum_length !== desired.character_maximum_length) {
    changes.push("character_maximum_length");
  }

  return changes;
}
