import { describe, expect, it } from "vitest";
import type { Index } from "../introspection-result";
import { compareIndices } from "./compare-indices";

describe("compareIndices", () => {
  const baseIndex: Index = {
    type: "index",
    name: "test_idx",
    table: "users",
    columns: ["email"],
    unique: false,
    sql: null,
  };

  it("should detect added indices", () => {
    const current: Index[] = [];
    const desired: Index[] = [baseIndex];

    const result = compareIndices(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.added[0]).toEqual(baseIndex);
  });

  it("should detect removed indices", () => {
    const current: Index[] = [baseIndex];
    const desired: Index[] = [];

    const result = compareIndices(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(0);
    expect(result.removed[0]).toEqual(baseIndex);
  });

  it("should detect modified indices", () => {
    const current: Index[] = [baseIndex];
    const desired: Index[] = [
      {
        ...baseIndex,
        unique: true,
        sql: "CREATE UNIQUE INDEX",
      },
    ];

    const result = compareIndices(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toEqual(["unique", "sql"]);
    expect(result.modified[0].current).toEqual(baseIndex);
    expect(result.modified[0].desired).toEqual(desired[0]);
  });

  it("should handle multiple changes simultaneously", () => {
    const current: Index[] = [
      baseIndex,
      { ...baseIndex, name: "test_idx2", columns: ["username"] },
    ];
    const desired: Index[] = [
      { ...baseIndex, unique: true },
      { ...baseIndex, name: "test_idx3", columns: ["age"] },
    ];

    const result = compareIndices(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(1);
  });

  it("should return empty diff for identical indices", () => {
    const current: Index[] = [baseIndex];
    const desired: Index[] = [{ ...baseIndex }];

    const result = compareIndices(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });
});
