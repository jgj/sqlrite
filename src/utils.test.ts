import { describe, it, expect } from "vitest";
import { toMap, toMapBy, toMapByName } from "./utils";

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
