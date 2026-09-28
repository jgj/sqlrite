import { describe, expect, it } from "vitest";
import { fts3ShadowTables } from "./fts3";

describe("fts3ShadowTables", () => {
  it("is undefined for other modules", () => {
    expect(fts3ShadowTables("fts5", "a")).toBeUndefined();
    expect(fts3ShadowTables("rtree", "id, a, b")).toBeUndefined();
  });

  it("gives FTS3 its fixed tables, whatever the arguments, and %_stat on demand", () => {
    expect(fts3ShadowTables("FTS3", "a, content=src")).toEqual({
      created: ["content", "segments", "segdir"],
      onDemand: ["stat"],
    });
  });

  it.each([
    ["a, b", ["content", "segments", "segdir", "docsize", "stat"]],
    ['content="src", a', ["segments", "segdir", "docsize", "stat"]],
    ["a, CONTENT=''", ["segments", "segdir", "docsize", "stat"]],
    ["a, matchinfo=fts3", ["content", "segments", "segdir", "stat"]],
    ["a, matchinfo='FTS3'", ["content", "segments", "segdir", "stat"]],
    ["a, matchinfo=fts4", ["content", "segments", "segdir", "docsize", "stat"]],
    ["content=src, matchinfo=fts3, a", ["segments", "segdir", "stat"]],
    // A column named content is not the option
    ["content, a", ["content", "segments", "segdir", "docsize", "stat"]],
  ])("gives FTS4 (%s) the tables it creates", (args, created) => {
    expect(fts3ShadowTables("fts4", args)).toEqual({ created, onDemand: [] });
  });
});
