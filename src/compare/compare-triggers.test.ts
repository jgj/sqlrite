import { describe, expect, it } from "vitest";
import type { Trigger } from "../introspection-result";
import { compareTriggers } from "./compare-triggers";

const baseTrigger: Trigger = {
  type: "trigger",
  name: "test_trigger",
  table: "test_table",
  sql: "CREATE TRIGGER test_trigger AFTER INSERT ON test_table FOR EACH ROW BEGIN END",
};

describe("compareTriggers", () => {
  it("should detect added triggers", () => {
    const current: Trigger[] = [];
    const desired: Trigger[] = [baseTrigger];

    const result = compareTriggers(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.added[0]).toEqual(baseTrigger);
  });

  it("should detect removed triggers", () => {
    const current: Trigger[] = [baseTrigger];
    const desired: Trigger[] = [];

    const result = compareTriggers(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(0);
    expect(result.removed[0]).toEqual(baseTrigger);
  });

  it("should detect modified triggers with table changes", () => {
    const current: Trigger[] = [baseTrigger];
    const desired: Trigger[] = [
      {
        ...baseTrigger,
        table: "new_table",
      },
    ];

    const result = compareTriggers(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0]?.changes).toContain("table");
  });

  it("should detect modified triggers with sql changes", () => {
    const current: Trigger[] = [baseTrigger];
    const desired: Trigger[] = [
      {
        ...baseTrigger,
        sql: "CREATE TRIGGER test_trigger BEFORE INSERT ON test_table FOR EACH ROW BEGIN END",
      },
    ];

    const result = compareTriggers(current, desired);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0]?.changes).toContain("sql");
  });

  it("should detect multiple changes in the same trigger", () => {
    const current: Trigger[] = [baseTrigger];
    const desired: Trigger[] = [
      {
        ...baseTrigger,
        table: "new_table",
        sql: "CREATE TRIGGER test_trigger BEFORE INSERT ON new_table FOR EACH ROW BEGIN END",
      },
    ];

    const result = compareTriggers(current, desired);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0]?.changes).toContain("table");
    expect(result.modified[0]?.changes).toContain("sql");
    expect(result.modified[0]?.changes).toHaveLength(2);
  });
});
