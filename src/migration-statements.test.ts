import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { compareSchema } from "./compare-schema";
import { getDriver, getNextDriver } from "./driver";
import { generateDDL } from "./generate-ddl";
import { introspect } from "./introspect";
import { createMigrationPlan } from "./migration-plan";
import { getMigrationStatements } from "./migration-statements";
import type { SQLite } from "./sqlite";

vi.mock("./compare-schema", () => ({
  compareSchema: vi.fn(),
}));

vi.mock("./driver", () => ({
  getDriver: vi.fn(),
  getNextDriver: vi.fn(),
}));

vi.mock("./generate-ddl", () => ({
  generateDDL: vi.fn(),
}));

vi.mock("./introspect", () => ({
  introspect: vi.fn(),
}));

vi.mock("./migration-plan", () => ({
  createMigrationPlan: vi.fn(),
}));

describe("getMigrationStatements", () => {
  const mockClient = { exec: vi.fn() } as unknown as SQLite;
  const mockDDL = "CREATE TABLE users (id INTEGER PRIMARY KEY)";

  const mockCurrentDriver = { name: "sqlite-current" };
  const mockNextDriver = { name: "sqlite-next" };
  const mockCurrentSchema = { tables: [{ name: "posts" }] };
  const mockNextSchema = { tables: [{ name: "posts" }, { name: "users" }] };
  const mockDiff = { added: [{ name: "users" }], dropped: [], altered: [] };
  const mockMigrationPlan = [{ type: "create_table", name: "users" }];
  const mockSQLStatements = ["CREATE TABLE users (id INTEGER PRIMARY KEY);"];

  beforeEach(() => {
    vi.resetAllMocks();
    (getDriver as Mock).mockReturnValue(mockCurrentDriver);
    (getNextDriver as Mock).mockResolvedValue(mockNextDriver);
    (introspect as Mock)
      .mockResolvedValueOnce(mockCurrentSchema)
      .mockResolvedValueOnce(mockNextSchema);
    (compareSchema as Mock).mockReturnValue(mockDiff);
    (createMigrationPlan as Mock).mockReturnValue(mockMigrationPlan);
    (generateDDL as Mock).mockReturnValue(mockSQLStatements);
  });

  it("should correctly orchestrate the migration process", async () => {
    const result = await getMigrationStatements(mockClient, mockDDL);

    // Verify function calls with correct arguments
    expect(getDriver).toHaveBeenCalledWith(mockClient);
    expect(introspect).toHaveBeenCalledWith(mockCurrentDriver);
    expect(getNextDriver).toHaveBeenCalledWith(mockClient, mockDDL);
    expect(introspect).toHaveBeenCalledWith(mockNextDriver);
    expect(compareSchema).toHaveBeenCalledWith(mockCurrentSchema, mockNextSchema);
    expect(createMigrationPlan).toHaveBeenCalledWith(mockDiff, {});
    expect(generateDDL).toHaveBeenCalledWith(mockMigrationPlan, mockCurrentSchema, mockNextSchema);

    // Verify result
    expect(result).toEqual(mockSQLStatements);
  });

  it("should handle empty migration plans", async () => {
    // Update mocks to simulate no changes
    (compareSchema as Mock).mockReturnValue({ added: [], dropped: [], altered: [] });
    (createMigrationPlan as Mock).mockReturnValue([]);
    (generateDDL as Mock).mockReturnValue([]);

    const result = await getMigrationStatements(mockClient, mockDDL);

    // Verify empty array is returned
    expect(result).toEqual([]);

    // Verify all functions were still called
    expect(getDriver).toHaveBeenCalled();
    expect(getNextDriver).toHaveBeenCalled();
    expect(introspect).toHaveBeenCalledTimes(2);
    expect(compareSchema).toHaveBeenCalled();
    expect(createMigrationPlan).toHaveBeenCalled();
    expect(generateDDL).toHaveBeenCalled();
  });
});
