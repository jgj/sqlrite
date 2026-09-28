import { describe, expect, it } from "vitest";
import type { VirtualTable } from "../introspection-result";
import { emptyIntrospection } from "../test-utils";
import { defaultModule } from "./default";

const desired = emptyIntrospection();

function vt(name: string, module: string, args: string): VirtualTable {
  return {
    type: "virtual_table",
    name,
    module,
    args,
    sql: `CREATE VIRTUAL TABLE ${name} USING ${module}(${args})`,
  };
}

describe("defaultModule", () => {
  describe("parseArgs + diff", () => {
    const equivalent = (a: string, b: string) =>
      defaultModule.diff(defaultModule.parseArgs(a), defaultModule.parseArgs(b));

    it.each([
      ["id, minX, maxX", "id,minX,maxX"],
      ["id, minX, maxX", "  id ,  minX ,\n maxX  "],
      ["id, minX, maxX", '"id", `minX`, [maxX]'],
    ])("treats (%s) and (%s) as equivalent", (a, b) => {
      expect(equivalent(a, b)).toEqual([]);
    });

    it.each([
      ["id, minX, maxX", "id, minX, maxX, minY, maxY"],
      ["id, minX, maxX", "id, minx, maxx"],
      ["a, b", "b, a"],
      ["x='a'", "x=a"],
    ])("reports (%s) and (%s) as a change", (a, b) => {
      const reasons = equivalent(a, b);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]?.check).toBe("virtual_table.args");
    });
  });

  it("does not support rename and has no dependencies", () => {
    const table = vt("rt", "rtree", "id, minX, maxX");
    expect(defaultModule.supportsRename).toBe(false);
    expect(defaultModule.dependencies(table, table.args)).toEqual([]);
    expect(defaultModule.onDependencyChanged).toBeUndefined();
    expect(defaultModule.rebuild).toBeUndefined();
  });

  it("recreates with DROP of the current table followed by the exact target SQL", () => {
    const current = vt("rt", "rtree", "id, minX, maxX");
    const target = vt("rt", "rtree", "id, minX, maxX, minY, maxY");
    expect(
      defaultModule.recreate({
        current,
        target,
        currentArgs: current.args,
        targetArgs: target.args,
        desired,
      }),
    ).toEqual([
      'DROP TABLE IF EXISTS "rt";',
      "CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX, minY, maxY);",
    ]);
  });

  describe("warnings", () => {
    it("warns that data is lost on drop", () => {
      const current = vt("rt", "rtree", "id, minX, maxX");
      const warnings = defaultModule.warnings({ op: { type: "drop", current }, desired });
      expect(warnings).toEqual([
        {
          type: "destructive",
          message: expect.stringContaining('Data in virtual table "rt" will be lost'),
        },
      ]);
    });

    it("warns that data is lost on recreate", () => {
      const current = vt("rt", "rtree", "id, minX, maxX");
      const target = vt("rt", "rtree", "id, minX, maxX, minY, maxY");
      const warnings = defaultModule.warnings({
        op: { type: "recreate", current, target, reasons: [] },
        desired,
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.type).toBe("destructive");
      expect(warnings[0]?.message).toContain('Data in virtual table "rt" will be lost');
    });

    it("does not warn on create", () => {
      const target = vt("rt", "rtree", "id, minX, maxX");
      expect(defaultModule.warnings({ op: { type: "create", target }, desired })).toEqual([]);
    });
  });
});
