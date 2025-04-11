import { describe, expect, it } from "vitest";
import type { ForeignKey } from "~/introspection-result";
import { compareForeignKeys } from "./compare-foreign-keys";

const baseForeignKey: ForeignKey = {
  type: "foreign_key",
  name: "test_fk",
  table: "test_table",
  column: "foreign_id",
  referenced_table: "referenced_table",
  referenced_column: "id",
  on_update: "NO ACTION",
  on_delete: "NO ACTION",
  definition: "FOREIGN KEY (foreign_id) REFERENCES referenced_table(id)",
};

describe("compareForeignKeys", () => {
  it("should detect added foreign keys", () => {
    const current: ForeignKey[] = [];
    const desired: ForeignKey[] = [baseForeignKey];

    const result = compareForeignKeys(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.added[0]).toEqual(baseForeignKey);
  });

  it("should detect removed foreign keys", () => {
    const current: ForeignKey[] = [baseForeignKey];
    const desired: ForeignKey[] = [];

    const result = compareForeignKeys(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(0);
    expect(result.removed[0]).toEqual(baseForeignKey);
  });

  it("should detect modified foreign keys", () => {
    const current: ForeignKey[] = [baseForeignKey];
    const desired: ForeignKey[] = [
      {
        ...baseForeignKey,
        on_delete: "CASCADE",
        referenced_table: "new_referenced_table",
      },
    ];

    const result = compareForeignKeys(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toContain("on_delete");
    expect(result.modified[0].changes).toContain("referenced_table");
  });

  it("should detect definition changes", () => {
    const current: ForeignKey[] = [baseForeignKey];
    const desired: ForeignKey[] = [
      {
        ...baseForeignKey,
        definition: "FOREIGN KEY (foreign_id) REFERENCES new_table(id)",
      },
    ];

    const result = compareForeignKeys(current, desired);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toContain("definition");
  });

  it("should handle multiple foreign keys", () => {
    const current: ForeignKey[] = [
      baseForeignKey,
      {
        ...baseForeignKey,
        name: "second_fk",
        column: "other_id",
      },
    ];
    const desired: ForeignKey[] = [
      {
        ...baseForeignKey,
        on_delete: "CASCADE",
      },
      {
        ...baseForeignKey,
        name: "third_fk",
        column: "third_id",
      },
    ];

    const result = compareForeignKeys(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(1);
    expect(result.added[0].name).toBe("third_fk");
    expect(result.removed[0].name).toBe("second_fk");
    expect(result.modified[0].changes).toContain("on_delete");
  });
});
