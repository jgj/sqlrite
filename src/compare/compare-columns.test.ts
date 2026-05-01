import { describe, expect, it } from "vitest";
import type { Column } from "../introspection-result";
import { compareColumns } from "./compare-columns";

const baseColumn: Column = {
  type: "column",
  name: "test_column",
  table: "test_table",
  data_type: "varchar",
  ordinal_position: 1,
  nullable: false,
  character_maximum_length: 255,
  precision: null,
  default: "",
  check_constraint: null,
  autoincrement: false,
  generated: "none",
};

describe("compareColumns", () => {
  it("should detect added columns", () => {
    const current: Column[] = [];
    const desired: Column[] = [baseColumn];

    const result = compareColumns(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.added[0]).toEqual(baseColumn);
  });

  it("should detect removed columns", () => {
    const current: Column[] = [baseColumn];
    const desired: Column[] = [];

    const result = compareColumns(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(0);
    expect(result.removed[0]).toEqual(baseColumn);
  });

  it("should detect modified columns", () => {
    const current: Column[] = [baseColumn];
    const desired: Column[] = [
      {
        ...baseColumn,
        nullable: true,
        data_type: "text",
      },
    ];

    const result = compareColumns(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toContain("nullable");
    expect(result.modified[0].changes).toContain("data_type");
  });

  it("should detect precision changes", () => {
    const current: Column[] = [
      {
        ...baseColumn,
        precision: { precision: 10, scale: 2 },
      },
    ];
    const desired: Column[] = [
      {
        ...baseColumn,
        precision: { precision: 12, scale: 3 },
      },
    ];

    const result = compareColumns(current, desired);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toContain("precision");
  });

  it("should detect character_maximum_length changes", () => {
    const current: Column[] = [
      {
        ...baseColumn,
        character_maximum_length: 255,
      },
    ];
    const desired: Column[] = [
      {
        ...baseColumn,
        character_maximum_length: 500,
      },
    ];

    const result = compareColumns(current, desired);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toContain("character_maximum_length");
  });
});
