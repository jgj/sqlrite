import { describe, expect, it } from "vitest";
import type { View } from "~/introspection-result";
import { compareViews } from "./compare-views";

describe("compareViews", () => {
  const baseView: View = {
    type: "view",
    name: "test_idx",
    sql: "CREATE VIEW test_view1 AS select name from test_table",
    tables: ["test_table"],
  };

  it("should detect added views", () => {
    const current: View[] = [];
    const desired: View[] = [baseView];

    const result = compareViews(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.added[0]).toEqual(baseView);
  });

  it("should detect removed views", () => {
    const current: View[] = [baseView];
    const desired: View[] = [];

    const result = compareViews(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(0);
    expect(result.removed[0]).toEqual(baseView);
  });

  it("should detect modified views", () => {
    const current: View[] = [baseView];
    const desired: View[] = [
      {
        ...baseView,
        sql: "CREATE VIEW test_view1 AS select name, created_at from test_table",
      },
    ];

    const result = compareViews(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes).toEqual(["sql"]);
    expect(result.modified[0].current).toEqual(baseView);
    expect(result.modified[0].desired).toEqual(desired[0]);
  });

  it("should handle multiple changes simultaneously", () => {
    const current: View[] = [baseView, { ...baseView, name: "test_view2" }];
    const desired: View[] = [
      { ...baseView, sql: "CREATE VIEW test_view1 AS select name, created_at from test_table" },
      { ...baseView, name: "test_view3" },
    ];

    const result = compareViews(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.modified).toHaveLength(1);
  });

  it("should return empty diff for identical views", () => {
    const current: View[] = [baseView];
    const desired: View[] = [{ ...baseView }];

    const result = compareViews(current, desired);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });
});
