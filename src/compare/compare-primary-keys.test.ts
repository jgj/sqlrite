import { describe, expect, it } from "vitest";
import type { PrimaryKey } from "~/introspection-result";
import { comparePrimaryKeys } from "./compare-primary-keys";

const basePrimaryKey: PrimaryKey = {
  type: "primary_key",
  table: "test_table",
  column: "id",
  field_count: 1,
  definition: "PRIMARY KEY (id)",
};

describe("comparePrimaryKeys", () => {
  it("should detect added primary keys", () => {
    const current: PrimaryKey[] = [];
    const desired: PrimaryKey[] = [basePrimaryKey];

    const result = comparePrimaryKeys(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.added[0]).toEqual(basePrimaryKey);
  });

  it("should detect removed primary keys", () => {
    const current: PrimaryKey[] = [basePrimaryKey];
    const desired: PrimaryKey[] = [];

    const result = comparePrimaryKeys(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(0);
    expect(result.removed[0]).toEqual(basePrimaryKey);
  });

  it("should detect modified primary keys", () => {
    const current: PrimaryKey[] = [basePrimaryKey];
    const desired: PrimaryKey[] = [
      {
        ...basePrimaryKey,
        column: "new_id",
        field_count: 2,
        definition: "PRIMARY KEY (id, new_id)",
      },
    ];

    const result = comparePrimaryKeys(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toContain("column");
    expect(result.modified[0].changes).toContain("field_count");
    expect(result.modified[0].changes).toContain("definition");
  });

  it("should handle multiple primary keys", () => {
    const current: PrimaryKey[] = [
      basePrimaryKey,
      {
        ...basePrimaryKey,
        table: "second_table",
        column: "second_id",
      },
    ];
    const desired: PrimaryKey[] = [
      {
        ...basePrimaryKey,
        column: "new_id",
      },
      {
        ...basePrimaryKey,
        table: "third_table",
        column: "third_id",
      },
    ];

    const result = comparePrimaryKeys(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(1);
    expect(result.added[0].table).toBe("third_table");
    expect(result.removed[0].table).toBe("second_table");
    expect(result.modified[0].changes).toContain("column");
  });

  it("should handle composite primary keys", () => {
    const current: PrimaryKey[] = [
      {
        ...basePrimaryKey,
        column: "id,tenant_id",
        field_count: 2,
        definition: "PRIMARY KEY (id, tenant_id)",
      },
    ];
    const desired: PrimaryKey[] = [
      {
        ...basePrimaryKey,
        column: "id,tenant_id,org_id",
        field_count: 3,
        definition: "PRIMARY KEY (id, tenant_id, org_id)",
      },
    ];

    const result = comparePrimaryKeys(current, desired);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toContain("column");
    expect(result.modified[0].changes).toContain("field_count");
    expect(result.modified[0].changes).toContain("definition");
  });
});
