import { describe, expect, it } from "vitest";
import type { Table, View } from "./introspection-result";
import { findViewsDependingOnTable, toMap, toMapBy, toMapByName } from "./utils";

describe("Map utility functions", () => {
  const testData = [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" },
    { id: 3, name: "Charlie", role: "user" },
  ];

  describe("toMap", () => {
    it("should create a Map using specified property as key", () => {
      const idMap = toMap(testData, "id");
      const nameMap = toMap(testData, "name");

      expect(idMap.get(1)).toBe(testData[0]);
      expect(nameMap.get("Bob")).toBe(testData[1]);
      expect(idMap.size).toBe(3);
    });
  });

  describe("toMapBy", () => {
    it("should create a Map using key selector function", () => {
      const roleMap = toMapBy(testData, (item) => `${item.role}_${item.id}`);

      expect(roleMap.get("admin_1")).toBe(testData[0]);
      expect(roleMap.get("user_2")).toBe(testData[1]);
      expect(roleMap.size).toBe(3);
    });
  });

  describe("toMapByName", () => {
    it("should create a Map using name property as key", () => {
      const nameMap = toMapByName(testData);

      expect(nameMap.get("Alice")).toBe(testData[0]);
      expect(nameMap.get("Bob")).toBe(testData[1]);
      expect(nameMap.size).toBe(3);
    });

    it("should work with any object containing a name property", () => {
      const customData = [
        { name: "Project A", value: 100 },
        { name: "Project B", value: 200 },
      ];

      const projectMap = toMapByName(customData);
      expect(projectMap.get("Project A")).toBe(customData[0]);
    });
  });
});

describe("findViewsDependingOnTable", () => {
  // Test table
  const usersTable: Table = {
    type: "table",
    name: "users",
    sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
    views: [],
    num_cols: 3,
  };

  // Test cases with various SQL patterns
  it("should detect views with direct FROM references", () => {
    const views: View[] = [
      {
        type: "view",
        name: "active_users",
        sql: "CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1",
        tables: [],
      },
      {
        type: "view",
        name: "product_list",
        sql: "CREATE VIEW product_list AS SELECT * FROM products",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toEqual(["active_users"]);
    expect(result).not.toContain("product_list");
  });

  it("should detect views with schema-qualified references", () => {
    const views: View[] = [
      {
        type: "view",
        name: "user_emails",
        sql: "CREATE VIEW user_emails AS SELECT email FROM main.users",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toEqual(["user_emails"]);
  });

  it("should detect views with JOIN references", () => {
    const views: View[] = [
      {
        type: "view",
        name: "user_orders",
        sql: "CREATE VIEW user_orders AS SELECT o.id, u.name FROM orders o JOIN users u ON o.user_id = u.id",
        tables: [],
      },
      {
        type: "view",
        name: "left_join_view",
        sql: "CREATE VIEW left_join_view AS SELECT p.name, c.name FROM products p LEFT JOIN categories c ON p.category_id = c.id",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toEqual(["user_orders"]);
    expect(result).not.toContain("left_join_view");
  });

  it("should detect views with table aliases", () => {
    const views: View[] = [
      {
        type: "view",
        name: "user_details",
        sql: "CREATE VIEW user_details AS SELECT u.id, u.name, u.email FROM users AS u WHERE u.active = 1",
        tables: [],
      },
      {
        type: "view",
        name: "user_profile",
        sql: "CREATE VIEW user_profile AS SELECT u.* FROM users u",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toContain("user_details");
    expect(result).toContain("user_profile");
    expect(result.length).toBe(2);
  });

  it("should detect views with column references", () => {
    const views: View[] = [
      {
        type: "view",
        name: "user_data",
        sql: "CREATE VIEW user_data AS SELECT orders.id, users.name FROM orders, users WHERE orders.user_id = users.id",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toEqual(["user_data"]);
  });

  it("should detect views with subqueries", () => {
    const views: View[] = [
      {
        type: "view",
        name: "complex_view",
        sql: "CREATE VIEW complex_view AS SELECT * FROM (SELECT id FROM users WHERE active = 1) as active_users",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toEqual(["complex_view"]);
  });

  it("should handle complex nested queries", () => {
    const views: View[] = [
      {
        type: "view",
        name: "nested_view",
        sql: "CREATE VIEW nested_view AS SELECT * FROM orders WHERE user_id IN (SELECT id FROM users WHERE signup_date > '2023-01-01')",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toEqual(["nested_view"]);
  });

  it("should correctly handle case-insensitive table names", () => {
    const views: View[] = [
      {
        type: "view",
        name: "uppercase_view",
        sql: "CREATE VIEW uppercase_view AS SELECT * FROM USERS",
        tables: [],
      },
      {
        type: "view",
        name: "mixed_case_view",
        sql: "CREATE VIEW mixed_case_view AS SELECT * FROM Users",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toContain("uppercase_view");
    expect(result).toContain("mixed_case_view");
    expect(result.length).toBe(2);
  });

  it("should not match table names that are substrings of other names", () => {
    const userStatsTable: Table = {
      type: "table",
      name: "user_stats",
      sql: "CREATE TABLE user_stats (user_id INTEGER, stat_name TEXT, value INTEGER)",
      views: [],
      num_cols: 3,
    };

    const views: View[] = [
      {
        type: "view",
        name: "users_view",
        sql: "CREATE VIEW users_view AS SELECT * FROM users",
        tables: [],
      },
      {
        type: "view",
        name: "stats_view",
        sql: "CREATE VIEW stats_view AS SELECT * FROM user_stats",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(userStatsTable, views);
    expect(result).toEqual(["stats_view"]);
    expect(result).not.toContain("users_view");
  });

  it("should handle table names with special characters", () => {
    const specialTable: Table = {
      type: "table",
      name: "user-data",
      sql: "CREATE TABLE [user-data] (id INTEGER, value TEXT)",
      views: [],
      num_cols: 2,
    };

    const views: View[] = [
      {
        type: "view",
        name: "special_view",
        sql: "CREATE VIEW special_view AS SELECT * FROM [user-data]",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(specialTable, views);
    expect(result).toEqual(["special_view"]);
  });

  it("should return an empty array when no dependencies exist", () => {
    const views: View[] = [
      {
        type: "view",
        name: "product_view",
        sql: "CREATE VIEW product_view AS SELECT * FROM products",
        tables: [],
      },
      {
        type: "view",
        name: "order_view",
        sql: "CREATE VIEW order_view AS SELECT * FROM orders",
        tables: [],
      },
    ];

    const result = findViewsDependingOnTable(usersTable, views);
    expect(result).toEqual([]);
  });

  it("should handle empty views array", () => {
    const result = findViewsDependingOnTable(usersTable, []);
    expect(result).toEqual([]);
  });
});
