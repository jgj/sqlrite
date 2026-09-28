import type { Database } from "better-sqlite3";
import type { IntrospectionResult } from "./introspection-result";

type VirtualTableOptions = Parameters<Database["table"]>[1];

export const cloneObject = <T extends object>(obj: T) => JSON.parse(JSON.stringify(obj)) as T;

/** An introspection result for an empty schema */
export function emptyIntrospection(): IntrospectionResult {
  return {
    tables: [],
    columns: [],
    indices: [],
    foreign_keys: [],
    primary_keys: [],
    triggers: [],
    views: [],
    virtual_tables: [],
  };
}

/**
 * Register a JavaScript virtual table module on a better-sqlite3 database, so
 * `CREATE VIRTUAL TABLE x USING <name>(arg, ...)` works there and nowhere
 * else. It stands in for an extension module (sqlite-vec, ...) that only some
 * connections have loaded. Each argument becomes a row with column k.
 */
export function registerFactoryModule(db: Database, name: string): void {
  const factory = (...args: string[]) => ({
    columns: ["k"],
    *rows() {
      for (const k of args) yield { k };
    },
  });
  // The factory form (parameterized CREATE VIRTUAL TABLE) is supported at
  // runtime but missing from @types/better-sqlite3
  db.table(name, factory as unknown as VirtualTableOptions);
}

/**
 * Gets the value at path of object.
 * Supports both dot notation and array notation (e.g., 'users[0].name' or '[0].users.name')
 *
 * @param obj The object to query
 * @param path The path of the property to get
 * @returns The resolved value or undefined if the path doesn't exist
 */
export function get(obj: object, path: string): unknown {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  // Handle array notation (e.g. "foo[0].bar" or "[0].foo.bar")
  // First, handle a path that might start with array notation
  let normalizedPath = path;
  if (path.startsWith("[")) {
    normalizedPath = path.substring(1);
  }

  // Then normalize the rest of the path
  normalizedPath = normalizedPath.replace(/\[(\w+)\]/g, ".$1");

  // If the path started with an array notation, we need to add the leading dot back
  if (path.startsWith("[")) {
    normalizedPath = `.${normalizedPath}`;
  }

  const keys = normalizedPath.split(".");
  // Filter out empty strings that might result from the split
  const filteredKeys = keys.filter((key) => key !== "");

  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let result: any = obj;

  for (const key of filteredKeys) {
    if (result === null || result === undefined || typeof result !== "object") {
      return undefined;
    }

    result = result[key];
  }

  return result;
}
