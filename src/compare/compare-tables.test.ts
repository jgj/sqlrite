import { describe, expect, it } from "vitest";
import type { Table } from "../introspection-result";
import { compareTables } from "./compare-tables";

describe("compareTables", () => {
  const createTable = (name: string, sql: string): Table => ({
    type: "table",
    name,
    sql,
    views: [],
    num_cols: 1,
  });

  it("should detect added tables", () => {
    const current: Table[] = [createTable("users", "CREATE TABLE users (id INT PRIMARY KEY)")];

    const desired: Table[] = [
      createTable("users", "CREATE TABLE users (id INT PRIMARY KEY)"),
      createTable("posts", "CREATE TABLE posts (id INT PRIMARY KEY)"),
    ];

    const result = compareTables(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.name).toBe("posts");
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it("should detect removed tables", () => {
    const current: Table[] = [
      createTable("users", "CREATE TABLE users (id INT PRIMARY KEY)"),
      createTable("posts", "CREATE TABLE posts (id INT PRIMARY KEY)"),
    ];

    const desired: Table[] = [createTable("users", "CREATE TABLE users (id INT PRIMARY KEY)")];

    const result = compareTables(current, desired);

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.name).toBe("posts");
    expect(result.added).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it("should detect modified tables", () => {
    const current: Table[] = [createTable("users", "CREATE TABLE users (id INT PRIMARY KEY)")];

    const desired: Table[] = [
      createTable("users", "CREATE TABLE users (id INT PRIMARY KEY, name TEXT)"),
    ];

    const result = compareTables(current, desired);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0]?.current.name).toBe("users");
    expect(result.modified[0]?.desired.name).toBe("users");
    expect(result.modified[0]?.changes).toEqual(["sql"]);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it("should handle empty inputs", () => {
    const result = compareTables([], []);

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it("should handle multiple changes simultaneously", () => {
    const current: Table[] = [
      createTable("users", "CREATE TABLE users (id INT PRIMARY KEY)"),
      createTable("posts", "CREATE TABLE posts (id INT PRIMARY KEY)"),
    ];

    const desired: Table[] = [
      createTable("users", "CREATE TABLE users (id INT PRIMARY KEY, name TEXT)"),
      createTable("comments", "CREATE TABLE comments (id INT PRIMARY KEY)"),
    ];

    const result = compareTables(current, desired);

    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.name).toBe("comments");
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.name).toBe("posts");
    expect(result.modified).toHaveLength(1);
    expect(result.modified[0]?.current.name).toBe("users");
  });
});
