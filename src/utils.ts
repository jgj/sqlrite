import type { Column, Table, View } from "./introspection-result";

export function toMap<T extends object>(items: T[], prop: keyof T) {
  return new Map(items.map((item) => [item[prop], item]));
}

export function toMapBy<T extends object, K>(items: T[], getKey: (item: T) => K) {
  return new Map(items.map((item) => [getKey(item), item]));
}

export function toMapByName<T extends { name: string }>(items: T[]) {
  return toMap(items, "name");
}

export const getColName = (col: Column) => `${col.table}.${col.name}`;

/**
 * Finds all views that depend on a specific table
 * @param table The table to check dependencies for
 * @param views List of all views to check against
 * @returns Array of view names that depend on the specified table
 */
export function findViewsDependingOnTable(table: Table, views: View[]): string[] {
  const tableName = table.name;

  // Check for various ways a table might be referenced in SQL
  return views
    .filter((view) => {
      const sql = view.sql.toLowerCase();
      const tableNameLower = tableName.toLowerCase();

      // Check for quoted identifiers (brackets, quotes, backticks)
      const quotedPatterns = [
        `[${tableNameLower}]`, // [users]
        `"${tableNameLower}"`, // "users"
        `\`${tableNameLower}\``, // `users`
      ];

      // Check for unquoted references with word boundaries
      const unquotedPattern = new RegExp(`\\b${escapeRegExp(tableNameLower)}\\b`, "i");

      // If any pattern matches, the view depends on the table
      return (
        quotedPatterns.some((pattern) => sql.includes(pattern.toLowerCase())) ||
        unquotedPattern.test(sql)
      );
    })
    .map((view) => view.name);
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Determines if two columns likely represent a rename operation
 *
 * @param removed The removed column
 * @param added The added column
 * @param strictMode If true, applies stricter matching criteria
 * @returns True if the columns appear to be a rename of the same column
 */
export function columnsLookLikeRename(
  removed: Column,
  added: Column,
  strictMode: boolean,
): boolean {
  // Must be different names in the same table
  if (removed.table !== added.table || removed.name === added.name) {
    return false;
  }

  // In strict mode, require exact type match
  if (strictMode && removed.data_type !== added.data_type) {
    return false;
  }

  // In relaxed mode, allow for data type variations like VARCHAR vs TEXT
  if (!strictMode && !areDataTypesCompatible(removed.data_type, added.data_type)) {
    return false;
  }

  // Required checks for both modes
  const basicMatch = removed.nullable === added.nullable;

  // For strict mode, verify all properties match
  if (strictMode) {
    return (
      basicMatch &&
      areValuesSimilar(removed.character_maximum_length, added.character_maximum_length) &&
      areValuesSimilar(removed.precision, added.precision) &&
      areValuesSimilar(removed.default, added.default)
    );
  }

  // For relaxed mode, consider it a match if basic properties match
  return basicMatch;
}

/**
 * Checks if two data types are compatible (could represent the same column)
 */
function areDataTypesCompatible(type1: string, type2: string): boolean {
  // Normalize types to lowercase
  const t1 = type1.toLowerCase();
  const t2 = type2.toLowerCase();

  // Exact match
  if (t1 === t2) return true;

  // Common compatible types
  const compatibleGroups = [
    ["varchar", "text", "char", "nvarchar", "nchar", "string"],
    ["int", "integer", "smallint", "bigint", "tinyint"],
    ["decimal", "numeric", "float", "real", "double"],
    ["boolean", "bool", "bit"],
    ["date", "time", "datetime", "timestamp"],
  ];

  return compatibleGroups.some((group) => group.includes(t1) && group.includes(t2));
}

/**
 * Compares two values for similarity, handling null, undefined, and objects
 */
function areValuesSimilar(a: unknown, b: unknown): boolean {
  // If both are null or undefined, they're similar
  if (a == null && b == null) return true;

  // If only one is null, they're different
  if (a == null || b == null) return false;

  // If they're objects (like precision), compare as JSON
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Otherwise compare directly
  return a === b;
}

type SuccessResult = {
  success: true;
  err: undefined;
};

type ErrorResult = {
  success: false;
  err: Error;
};

export type Result = SuccessResult | ErrorResult;

class UnknownError extends Error {
  constructor(readonly cause: unknown) {
    super("An unknown error occurred");
  }
}

export const result = (err?: unknown) => {
  if (err === undefined) return { success: true } as Result;
  if (err instanceof Error) {
    return { success: false, err } as Result;
  }
  return { success: false, err: new UnknownError(err) } as Result;
};

export function sqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

class InvariantError extends TypeError {}

export function invariant(thing: unknown, msg = "Invariant received falsy value"): asserts thing {
  if (thing) return;

  throw new InvariantError(msg);
}

export function isTesting() {
  return process.env.NODE_ENV === "test";
}
