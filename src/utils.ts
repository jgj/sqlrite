import type { Column, View } from "./introspection-result";

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
 * Fold the case of a table, view or virtual table name the way SQLite matches
 * identifiers: only ASCII letters are case-insensitive, so "Ä" and "ä" are
 * two different names while "Docs" and "docs" are the same one.
 */
export function foldName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Whether two lists name the same objects, in any order (see foldName) */
export function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const sorted = (names: readonly string[]) => names.map(foldName).sort();
  const left = sorted(a);
  const right = sorted(b);
  return left.length === right.length && left.every((name, i) => name === right[i]);
}

/** The item whose name SQLite takes to be `name` (see foldName) */
export function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const folded = foldName(name);
  return items.find((item) => foldName(item.name) === folded);
}

/**
 * Finds all views that depend on a specific table (regular or virtual)
 * @param table The table to check dependencies for
 * @param views List of all views to check against (or of other objects with a
 *              SQL body, such as triggers)
 * @returns Array of view names that depend on the specified table
 */
export function findViewsDependingOnTable(
  table: { name: string },
  views: Pick<View, "name" | "sql">[],
): string[] {
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
      removed.generated === added.generated &&
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
  constructor(cause: unknown) {
    super("An unknown error occurred", { cause });
  }
}

export class MigrationError extends Error {
  readonly statementIndex: number;
  readonly statement: string;
  constructor(statementIndex: number, statement: string, cause: Error) {
    super(
      `Migration failed at statement ${statementIndex + 1}:\n  ${statement}\n\nCause: ${cause.message}`,
      { cause },
    );
    this.name = "MigrationError";
    this.statementIndex = statementIndex;
    this.statement = statement;
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

// Helper to ensure SQL statements end with a semicolon
export function ensureSemicolon(sql: string): string {
  if (!sql) return "";
  return sql.trim().endsWith(";") ? sql : `${sql};`;
}

class InvariantError extends TypeError {}

export function invariant(thing: unknown, msg = "Invariant received falsy value"): asserts thing {
  if (thing) return;

  throw new InvariantError(msg);
}

export function isTesting() {
  return process.env.NODE_ENV === "test";
}
