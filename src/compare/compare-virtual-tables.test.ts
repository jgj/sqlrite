import { describe, expect, it } from "vitest";
import type { VirtualTable } from "../introspection-result";
import { compareVirtualTables } from "./compare-virtual-tables";

function vt(sqlText: string): VirtualTable {
  const match = /^CREATE VIRTUAL TABLE (\S+)\s+USING\s+(\w+)\s*\((.*)\)$/is.exec(sqlText);
  if (!match?.[1] || !match[2] || match[3] === undefined) throw new Error(`bad sql ${sqlText}`);
  return {
    type: "virtual_table",
    name: match[1].replace(/"/g, ""),
    module: match[2],
    args: match[3],
    sql: sqlText,
  };
}

describe("compareVirtualTables", () => {
  it("reports added and removed virtual tables by name", () => {
    const kept = vt("CREATE VIRTUAL TABLE kept USING rtree(id, a, b)");
    const gone = vt("CREATE VIRTUAL TABLE gone USING rtree(id, a, b)");
    const fresh = vt("CREATE VIRTUAL TABLE fresh USING rtree(id, a, b)");

    const diff = compareVirtualTables([kept, gone], [kept, fresh]);

    expect(diff.added).toEqual([fresh]);
    expect(diff.removed).toEqual([gone]);
    expect(diff.modified).toEqual([]);
  });

  it("does not report cosmetically different but equivalent definitions", () => {
    const current = vt('CREATE VIRTUAL TABLE "rt" USING rtree(id, minX, maxX)');
    const desired = vt("CREATE VIRTUAL TABLE rt   USING   RTREE ( id ,  minX , maxX )");

    expect(compareVirtualTables([current], [desired])).toEqual({
      added: [],
      removed: [],
      modified: [],
    });
  });

  it("reports changed arguments as modified args", () => {
    const current = vt("CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX)");
    const desired = vt("CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX, minY, maxY)");

    expect(compareVirtualTables([current], [desired]).modified).toEqual([
      { current, desired, changes: ["args"] },
    ]);
  });

  it("matches names case-insensitively, as SQLite does", () => {
    const current = vt("CREATE VIRTUAL TABLE Docs USING fts5(body)");
    const same = vt("CREATE VIRTUAL TABLE docs USING fts5(body)");
    const changed = vt("CREATE VIRTUAL TABLE DOCS USING fts5(body, extra)");

    expect(compareVirtualTables([current], [same])).toEqual({
      added: [],
      removed: [],
      modified: [],
    });
    expect(compareVirtualTables([current], [changed])).toEqual({
      added: [],
      removed: [],
      modified: [{ current, desired: changed, changes: ["args"] }],
    });
  });

  it("reports a module change as modified module", () => {
    const current = vt("CREATE VIRTUAL TABLE t USING fts4(a, b)");
    const desired = vt("CREATE VIRTUAL TABLE t USING fts3(a, b)");

    expect(compareVirtualTables([current], [desired]).modified).toEqual([
      { current, desired, changes: ["module"] },
    ]);
  });
});
