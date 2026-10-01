// The parts of a CREATE TABLE statement, for checking what ALTER TABLE can do.
//
// ALTER TABLE ADD/DROP/RENAME COLUMN only change the column they name (and,
// for RENAME COLUMN, the references to it). Any other difference between the
// current and the desired CREATE TABLE (a table constraint, a column
// constraint, a collation, table options) needs a recreate.

import { normalizeSql } from "./compare/normalize-sql";
import type { Table } from "./introspection-result";
import type { ColumnRename } from "./migration-operation";
import { foldName } from "./utils";
import { leadingIdentifier, renameIdentifier, splitCreateTable } from "./virtual-tables/parse";

type TableDefinition = {
  /** Column definitions, as written, by name (folded) */
  columns: Map<string, string>;
  /** Table constraints, as written */
  constraints: string[];
  /** Table options (STRICT, WITHOUT ROWID), as written */
  options: string;
};

const CONSTRAINT_KEYWORDS = new Set(["constraint", "primary", "unique", "check", "foreign"]);

/** Throws a SyntaxError when the text is not a CREATE TABLE statement with a column list */
function parseTableDefinition(sql: string): TableDefinition {
  const { items, options } = splitCreateTable(sql);
  const columns = new Map<string, string>();
  const constraints: string[] = [];
  for (const item of items) {
    // A column named like a constraint keyword has to be quoted
    const name = leadingIdentifier(item);
    const quoted = /^["`[']/.test(item);
    if (name === undefined || (!quoted && CONSTRAINT_KEYWORDS.has(foldName(name)))) {
      constraints.push(item);
    } else {
      columns.set(foldName(name), item);
    }
  }
  return { columns, constraints, options };
}

/**
 * The definition of a column in a CREATE TABLE statement, as written, with
 * the column's name double-quoted wherever it appears (sqlrite quotes every
 * name it writes)
 */
export function columnDefinitionText(tableSql: string, column: string): string | undefined {
  try {
    const text = parseTableDefinition(tableSql).columns.get(foldName(column));
    return text === undefined ? undefined : renameIdentifier(text, column, column);
  } catch {
    return undefined;
  }
}

export type ColumnChanges = {
  dropped: string[];
  /** Added by ALTER TABLE ADD COLUMN with their definition from the desired table */
  added: string[];
  renamed: ColumnRename[];
};

/**
 * Whether dropping, adding and renaming these columns with ALTER TABLE turns
 * the current table into the desired one, column order aside (column order is
 * checked on its own). When it does not, the table has other changes that
 * only a recreate can make. A statement that cannot be parsed is taken to
 * need a recreate.
 */
export function columnChangesExplainTable(
  current: Table,
  desired: Table,
  changes: ColumnChanges,
): boolean {
  let curr: TableDefinition;
  let next: TableDefinition;
  try {
    curr = parseTableDefinition(current.sql);
    next = parseTableDefinition(desired.sql);
  } catch {
    return false;
  }

  const rename = (text: string) =>
    changes.renamed.reduce((acc, { from, to }) => renameIdentifier(acc, from, to), text);
  const newName = new Map(changes.renamed.map(({ from, to }) => [foldName(from), foldName(to)]));
  const dropped = new Set(changes.dropped.map(foldName));

  const expected = new Map<string, string>();
  for (const [name, text] of curr.columns) {
    if (dropped.has(name)) continue;
    expected.set(newName.get(name) ?? name, rename(text));
  }
  for (const name of changes.added) {
    const text = next.columns.get(foldName(name));
    if (text === undefined) return false;
    expected.set(foldName(name), text);
  }

  const sameColumns =
    expected.size === next.columns.size &&
    [...expected].every(([name, text]) => {
      const desiredText = next.columns.get(name);
      return desiredText !== undefined && normalizeSql(text) === normalizeSql(desiredText);
    });
  const sorted = (items: string[]) => items.map((item) => normalizeSql(item)).sort();
  const sameConstraints =
    JSON.stringify(sorted(curr.constraints.map(rename))) ===
    JSON.stringify(sorted(next.constraints));

  return (
    sameColumns && sameConstraints && normalizeSql(curr.options) === normalizeSql(next.options)
  );
}
