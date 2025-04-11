import { describe, it, expect, vi } from "vitest";
import { compareSchema } from "./compare-schema";
import { compareColumns } from "./compare/compare-columns";
import { compareForeignKeys } from "./compare/compare-foreign-keys";
import { compareIndices } from "./compare/compare-indices";
import { comparePrimaryKeys } from "./compare/compare-primary-keys";
import { compareTables } from "./compare/compare-tables";
import { compareTriggers } from "./compare/compare-triggers";
import type { IntrospectionObjectType, IntrospectionResult } from "./introspection-result";
import { cloneObject } from "./test-utils";
import { compareViews } from "./compare/compare-views";

vi.mock("./compare/compare-tables", () => ({
  compareTables: vi.fn().mockReturnValue({ added: [], removed: [], modified: [] }),
}));

vi.mock("./compare/compare-columns", () => ({
  compareColumns: vi.fn().mockReturnValue({ added: [], removed: [], modified: [] }),
}));

vi.mock("./compare/compare-indices", () => ({
  compareIndices: vi.fn().mockReturnValue({ added: [], removed: [], modified: [] }),
}));

vi.mock("./compare/compare-foreign-keys", () => ({
  compareForeignKeys: vi.fn().mockReturnValue({ added: [], removed: [], modified: [] }),
}));

vi.mock("./compare/compare-primary-keys", () => ({
  comparePrimaryKeys: vi.fn().mockReturnValue({ added: [], removed: [], modified: [] }),
}));

vi.mock("./compare/compare-triggers", () => ({
  compareTriggers: vi.fn().mockReturnValue({ added: [], removed: [], modified: [] }),
}));

vi.mock("./compare/compare-views", () => ({
  compareViews: vi.fn().mockReturnValue({ added: [], removed: [], modified: [] }),
}));

describe("compareSchema", () => {
  it("calls each comparison function with the correct portion of the schema", () => {
    const current: IntrospectionResult = {
      tables: [{ type: "table", name: "test", sql: "", views: [], num_cols: 1 }],
      columns: [
        {
          type: "column",
          name: "id",
          table: "test",
          data_type: "int",
          ordinal_position: 1,
          nullable: false,
          character_maximum_length: null,
          precision: null,
          default: "",
        },
      ],
      indices: [
        {
          type: "index",
          name: "idx_test",
          table: "test",
          columns: ["id"],
          unique: false,
          sql: null,
        },
      ],
      foreign_keys: [
        {
          type: "foreign_key",
          name: "fk_test",
          table: "test",
          column: "id",
          referenced_table: "other",
          referenced_column: "id",
          on_update: "",
          on_delete: "",
          definition: "",
        },
      ],
      primary_keys: [
        { type: "primary_key", table: "test", column: "id", field_count: 1, definition: "" },
      ],
      triggers: [{ type: "trigger", name: "trg_test", table: "test", sql: "" }],
      views: [{ type: "view", name: "trg_test", sql: "", tables: [] }],
    };

    const desired = cloneObject(current);

    compareSchema(current, desired);

    expect(compareTables).toHaveBeenCalledWith(current.tables, desired.tables);
    expect(compareColumns).toHaveBeenCalledWith(current.columns, desired.columns);
    expect(compareIndices).toHaveBeenCalledWith(current.indices, desired.indices);
    expect(compareForeignKeys).toHaveBeenCalledWith(current.foreign_keys, desired.foreign_keys);
    expect(comparePrimaryKeys).toHaveBeenCalledWith(current.primary_keys, desired.primary_keys);
    expect(compareTriggers).toHaveBeenCalledWith(current.triggers, desired.triggers);
    expect(compareViews).toHaveBeenCalledWith(current.views, desired.views);
  });

  it("returns a properly structured diff object", () => {
    const current: IntrospectionResult = {
      tables: [],
      columns: [],
      indices: [],
      foreign_keys: [],
      primary_keys: [],
      triggers: [],
      views: [],
    };
    const desired = cloneObject(current);

    const result = compareSchema(current, desired);

    expect(result).toEqual({
      table: { added: [], removed: [], modified: [] },
      column: { added: [], removed: [], modified: [] },
      index: { added: [], removed: [], modified: [] },
      foreign_key: { added: [], removed: [], modified: [] },
      primary_key: { added: [], removed: [], modified: [] },
      trigger: { added: [], removed: [], modified: [] },
      view: { added: [], removed: [], modified: [] },
      current,
      desired,
    });

    for (const key of [
      "table",
      "column",
      "index",
      "foreign_key",
      "primary_key",
      "trigger",
      "view",
    ] as IntrospectionObjectType[]) {
      expect(result[key]).toHaveProperty("added");
      expect(result[key]).toHaveProperty("removed");
      expect(result[key]).toHaveProperty("modified");
      expect(Array.isArray(result[key].added)).toBe(true);
      expect(Array.isArray(result[key].removed)).toBe(true);
      expect(Array.isArray(result[key].modified)).toBe(true);
    }
  });
});
