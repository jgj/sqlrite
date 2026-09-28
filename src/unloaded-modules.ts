import type { IntrospectionResult } from "./introspection-result";
import { foldName } from "./utils";

/**
 * Tables named like the shadow tables of a virtual table whose module is not
 * loaded on the connection, which introspection therefore hides (see
 * hideUnloadedModuleShadows in introspect.ts)
 */
export type UnloadedModuleShadows = {
  virtualTable: string;
  module: string;
  tables: string[];
};

/** Hides the tables again, keeping those in `keep` (names folded by foldName) visible */
export type RevealTables = (keep: ReadonlySet<string>) => {
  schema: IntrospectionResult;
  hidden: UnloadedModuleShadows[];
};

const revealers = new WeakMap<IntrospectionResult, RevealTables>();

/** Called by introspect when it hid tables of a virtual table whose module is not loaded */
export function rememberHiddenTables(schema: IntrospectionResult, reveal: RevealTables): void {
  revealers.set(schema, reveal);
}

/**
 * Undo the hiding for the tables the desired schema declares as regular
 * tables. The desired schema is built where those names are never shadow
 * tables, so hiding them on the live side only would make them look missing
 * there (a CREATE TABLE for a table that exists, an ADD COLUMN or a rename
 * that is never emitted). Returns the schema unchanged when introspection hid
 * nothing, and the tables that stay hidden.
 */
export function revealDeclaredTables(
  schema: IntrospectionResult,
  declaredTables: readonly string[],
): { schema: IntrospectionResult; unloadedModuleShadows: UnloadedModuleShadows[] } {
  const reveal = revealers.get(schema);
  if (!reveal) return { schema, unloadedModuleShadows: [] };

  const keep = new Set(declaredTables.map(foldName));
  const { schema: visible, hidden } = reveal(keep);
  const revealed = visible.tables.length !== schema.tables.length;
  return { schema: revealed ? visible : schema, unloadedModuleShadows: hidden };
}
