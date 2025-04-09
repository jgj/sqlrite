export const cloneObject = <T extends object>(obj: T) => JSON.parse(JSON.stringify(obj)) as T;

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
