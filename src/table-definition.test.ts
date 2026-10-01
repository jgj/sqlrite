import { describe, expect, it } from "vitest";
import type { Table } from "./introspection-result";
import {
  type ColumnChanges,
  columnChangesExplainTable,
  columnDefinitionText,
} from "./table-definition";

function table(sql: string): Table {
  return { type: "table", name: "t", sql, views: [], num_cols: 0 };
}

const none: ColumnChanges = { dropped: [], added: [], renamed: [] };

function explains(current: string, desired: string, changes: Partial<ColumnChanges>): boolean {
  return columnChangesExplainTable(table(current), table(desired), { ...none, ...changes });
}

describe("columnChangesExplainTable", () => {
  it("is explained by an added column", () => {
    expect(
      explains(
        "CREATE TABLE t (id INTEGER, a TEXT)",
        "CREATE TABLE t (id INTEGER, a TEXT, b TEXT)",
        { added: ["b"] },
      ),
    ).toBe(true);
  });

  it("is not explained by an added column when a table constraint is also added", () => {
    expect(
      explains(
        "CREATE TABLE t (id INTEGER, a TEXT)",
        "CREATE TABLE t (id INTEGER, a TEXT, b TEXT, CHECK (length(a) > 0))",
        { added: ["b"] },
      ),
    ).toBe(false);
  });

  it("is not explained by a dropped column when another column changes its collation", () => {
    expect(
      explains(
        "CREATE TABLE t (id INTEGER, a TEXT, b TEXT)",
        "CREATE TABLE t (id INTEGER, a TEXT COLLATE NOCASE)",
        { dropped: ["b"] },
      ),
    ).toBe(false);
  });

  it("is explained by a rename that SQLite also applies to the constraints", () => {
    expect(
      explains(
        "CREATE TABLE t (id INTEGER, old TEXT CHECK (old <> ''), CHECK (length(old) < 9))",
        "CREATE TABLE t (id INTEGER, \"new\" TEXT CHECK (new <> ''), CHECK (length(new) < 9))",
        { renamed: [{ from: "old", to: "new" }] },
      ),
    ).toBe(true);
  });

  it("is not explained by a rename when a table constraint is also added", () => {
    expect(
      explains(
        "CREATE TABLE t (id INTEGER, old TEXT)",
        "CREATE TABLE t (id INTEGER, new TEXT, CHECK (length(new) > 0))",
        { renamed: [{ from: "old", to: "new" }] },
      ),
    ).toBe(false);
  });

  it("is not explained when the table options change", () => {
    expect(
      explains(
        "CREATE TABLE t (id INTEGER, a TEXT)",
        "CREATE TABLE t (id INTEGER, a TEXT) STRICT",
        {},
      ),
    ).toBe(false);
  });

  it("ignores column order and quoting", () => {
    expect(
      explains(
        'CREATE TABLE t (id INTEGER, "a" TEXT, b TEXT)',
        "CREATE TABLE t (id INTEGER, b TEXT, a TEXT)",
        {},
      ),
    ).toBe(true);
  });

  it("does not take a quoted column named like a constraint keyword for a constraint", () => {
    expect(
      explains(
        'CREATE TABLE t (id INTEGER, "check" TEXT)',
        'CREATE TABLE t (id INTEGER, "check" TEXT, unique_id TEXT)',
        { added: ["unique_id"] },
      ),
    ).toBe(true);
  });
});

describe("columnDefinitionText", () => {
  it("returns the definition as written, with the column's name quoted", () => {
    expect(
      columnDefinitionText(
        "CREATE TABLE t (id INTEGER, updated_at TEXT NOT NULL DEFAULT (strftime('%s', 'now')) CHECK (updated_at <> ''))",
        "updated_at",
      ),
    ).toBe(`"updated_at" TEXT NOT NULL DEFAULT (strftime('%s', 'now')) CHECK ("updated_at" <> '')`);
  });

  it("returns undefined for a missing column", () => {
    expect(columnDefinitionText("CREATE TABLE t (id INTEGER)", "a")).toBeUndefined();
  });
});
