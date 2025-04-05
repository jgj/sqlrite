import type { Column } from "./introspection-result";

export function toMap<T extends object>(items: T[], prop: keyof T) {
  return new Map(items.map((item) => [item[prop], item]));
}

export function toMapBy<T extends object, K>(items: T[], getKey: (item: T) => K) {
  return new Map(items.map((item) => [getKey(item), item]));
}

export function toMapByName<T extends { name: string }>(items: T[]) {
  return toMap(items, "name");
}

export const getColName = (col: Column) => `${col.table}.${col.name}`;
