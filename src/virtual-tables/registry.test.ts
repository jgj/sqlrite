import { describe, expect, it } from "vitest";
import type { VirtualTable } from "../introspection-result";
import { defaultModule } from "./default";
import {
  getRecreateModule,
  getVirtualTableModule,
  registerVirtualTableModule,
  resolveVirtualTable,
  sameModule,
  virtualTableDifferences,
} from "./registry";
import type { VirtualTableModule } from "./types";

function vt(name: string, module: string, args: string): VirtualTable {
  return {
    type: "virtual_table",
    name,
    module,
    args,
    sql: `CREATE VIRTUAL TABLE ${name} USING ${module}(${args})`,
  };
}

// A module whose arguments are a case-insensitive set of words
const wordsModule: VirtualTableModule<string[]> = {
  name: "Registry_Test_Words",
  parseArgs: (args) =>
    args
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .sort(),
  diff: (current, desired) =>
    current.join() === desired.join() ? [] : [{ check: "words", detail: "words differ" }],
  supportsRename: true,
  dependencies: () => [],
  recreate: () => ["-- words recreate"],
  warnings: () => [],
};

registerVirtualTableModule(wordsModule);

describe("virtual table module registry", () => {
  it("falls back to the default module for unregistered modules", () => {
    expect(getVirtualTableModule("rtree")).toBe(defaultModule);
    expect(getVirtualTableModule("vec0")).toBe(defaultModule);
  });

  it("looks registered modules up case-insensitively", () => {
    expect(getVirtualTableModule("registry_test_words")).toBe(wordsModule);
    expect(getVirtualTableModule("REGISTRY_TEST_WORDS")).toBe(wordsModule);
  });

  it("resolves a virtual table to its handler and parsed args", () => {
    const { handler, args } = resolveVirtualTable(vt("w", "registry_test_words", "B, a"));
    expect(handler).toBe(wordsModule);
    expect(args).toEqual(["a", "b"]);
  });

  it("compares module names case-insensitively", () => {
    expect(sameModule(vt("a", "RTREE", ""), vt("b", "rtree", ""))).toBe(true);
    expect(sameModule(vt("a", "rtree", ""), vt("b", "fts4", ""))).toBe(false);
  });

  describe("virtualTableDifferences", () => {
    it("uses the handler's diff, ignoring the table name", () => {
      expect(
        virtualTableDifferences(
          vt("a", "registry_test_words", "x, y"),
          vt("b", "REGISTRY_TEST_WORDS", "Y, X"),
        ),
      ).toEqual([]);
      expect(
        virtualTableDifferences(
          vt("a", "registry_test_words", "x"),
          vt("a", "registry_test_words", "x, y"),
        ),
      ).toEqual([{ check: "words", detail: "words differ" }]);
    });

    it("reports a module change without consulting either handler", () => {
      expect(
        virtualTableDifferences(vt("a", "rtree", "id, x0, x1"), vt("a", "fts4", "id, x0, x1")),
      ).toEqual([{ check: "virtual_table.module", detail: "Module changed: rtree → fts4" }]);
    });
  });

  describe("getRecreateModule", () => {
    it("uses the module's own handler when the module is unchanged", () => {
      const current = vt("w", "registry_test_words", "a");
      const target = vt("w", "registry_test_words", "a, b");
      expect(getRecreateModule({ type: "recreate", current, target, reasons: [] })).toBe(
        wordsModule,
      );
    });

    it("falls back to the default handler when the module changes", () => {
      const current = vt("w", "rtree", "id, a, b");
      const target = vt("w", "registry_test_words", "a, b");
      expect(getRecreateModule({ type: "recreate", current, target, reasons: [] })).toBe(
        defaultModule,
      );
    });
  });
});
