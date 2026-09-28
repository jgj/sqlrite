import { describe, expect, it } from "vitest";
import type { Table, VirtualTable } from "./introspection-result";
import { type RenameOperation, getTableRenameMap } from "./migration-operation";

const table = (name: string): Table => ({
  type: "table",
  name,
  sql: `CREATE TABLE ${name} (x)`,
  views: [],
  num_cols: 1,
});

const vtable = (name: string): VirtualTable => ({
  type: "virtual_table",
  name,
  module: "fts5",
  args: "y",
  sql: `CREATE VIRTUAL TABLE ${name} USING fts5(y)`,
});

function rename<T extends Table | VirtualTable>(current: T, target: string): RenameOperation<T> {
  return { type: "rename", current, target: { ...current, name: target } };
}

describe("getTableRenameMap", () => {
  it("maps each renamed table to its new name, by its folded current name", () => {
    expect(getTableRenameMap([rename(table("Docs"), "articles")])).toEqual(
      new Map([["docs", "articles"]]),
    );
  });

  it("ignores virtual table renames", () => {
    expect(getTableRenameMap([rename(vtable("a"), "b")])).toEqual(new Map());
  });

  // A swap (see orderRenames in migration-plan.ts): t1 goes aside to a
  // temporary name while the virtual table t2 takes t1, then takes t2
  it("follows a rename through a temporary name to the final name", () => {
    const map = getTableRenameMap([
      rename(table("t1"), "sqlrite_rename_t2"),
      rename(vtable("t2"), "t1"),
      rename(table("sqlrite_rename_t2"), "t2"),
    ]);
    expect(map).toEqual(new Map([["t1", "t2"]]));
  });
});
