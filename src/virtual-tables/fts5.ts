import { normalizeSql } from "../compare/normalize-sql";
import type { DDLStatement } from "../generate-ddl";
import type { IntrospectionResult, VirtualTable } from "../introspection-result";
import type { RecreateReason } from "../migration-operation";
import type { MigrationWarning } from "../migration-statements";
import { ensureSemicolon, findByName, foldName, invariant, sqlIdentifier as sql } from "../utils";
import { skipQuoted, splitModuleArgs, unquoteIdentifier } from "./parse";
import type { VirtualTableModule, VirtualTableRecreateContext } from "./types";

// Handler for FTS5 full-text tables.
//
// Equivalence: SQLite stores the module arguments verbatim, so the arguments
// are parsed and normalized, and only differences FTS5 itself treats as
// different are reported. Every normalization below was checked against
// SQLite (index contents and MATCH results compared across spellings):
// - quoting ("x", 'x', `x`, [x], bare) of column names and option values
// - option-name case and order; repeated prefix= options accumulate, and the
//   prefix lengths are a set (their order only changes the index layout,
//   which FTS5 re-reads from the stored DDL)
// - tokenizer-name case, whitespace and the quoting of each tokenizer word
//   (FTS5 dequotes them: 'porter' 'ascii' is porter ascii); bare porter is
//   porter unicode61; no tokenizer is unicode61, and unicode61's
//   remove_diacritics 1 is its default (0 and 2 are not)
// - detail=full and columnsize=1 are the defaults; content_rowid=rowid is the
//   same as omitting it, and content_rowid has no effect without content=
// - the UNINDEXED keyword's case and quoting
// Anything else is compared as written: column-name case (it changes the keys
// SELECT * returns), tokenizer arguments (apart from their quoting), and
// options whose default was not verified (tokendata, locale,
// contentless_delete, contentless_unindexed).
//
// Recreates never touch shadow tables (better-sqlite3 runs in defensive mode,
// where they are read-only) and never rename the table (a rename rewrites the
// view and trigger bodies that reference it). Depending on the content mode:
// - own content: rows are copied out to a temp table, the table is dropped and
//   created with the exact desired SQL, and the rows are inserted back with
//   their rowids, which re-indexes them with the new configuration; with
//   locale=1 on both sides, each value keeps its locale
// - external content (content=T): drop, create, 'rebuild' from T
// - contentless (content=''): column values cannot be read back, so the new
//   table starts empty unless the rows can be read from the old table's own
//   content or from its content table
// A table that stops being external-content gets the rows of its former
// content table (under its new name when the migration renames it), or of its
// former content view, read through the old table before anything changes.
// The runtime settings kept in the %_config shadow table (rank, automerge,
// pgsz, secure-delete, ...) are not part of the DDL; they are copied to the new
// table through FTS5's own configuration interface.

export type Fts5Column = {
  /** Unquoted, case as written */
  name: string;
  unindexed: boolean;
};

export type Fts5Content =
  | { mode: "own" }
  | { mode: "contentless" }
  | {
      mode: "external";
      /** Unquoted, case as written */
      table: string;
      /** content_rowid, or null for the content table's rowid */
      rowid: string | null;
    };

export type Fts5Args = {
  columns: Fts5Column[];
  content: Fts5Content;
  /** Normalized tokenizer words (see normalizeTokenizer) */
  tokenize: string[];
  /** Prefix index lengths, deduplicated and sorted */
  prefix: string[];
  /** Lowercase; defaults to "full" */
  detail: string;
  /** Defaults to "1" */
  columnsize: string;
  /** Other options by lowercase name, compared by unquoted value with no assumed default */
  options: Map<string, string>;
  /** Arguments this parser does not understand, compared as normalized text */
  unparsed: string[];
};

const DEFAULT_TOKENIZER = "unicode61";
const QUOTES = new Set(['"', "'", "`", "["]);

type Token = { text: string; quoted: boolean; rest: string };

// A quoted identifier or string (unquoted), or a run of characters up to
// whitespace or '='. Throws on an unterminated quote.
function readToken(input: string): Token | null {
  const text = input.trimStart();
  const first = text[0];
  if (first === undefined) return null;
  if (QUOTES.has(first)) {
    const end = skipQuoted(text, 0);
    return { text: unquoteIdentifier(text.slice(0, end)), quoted: true, rest: text.slice(end) };
  }
  const match = /^[^\s=]+/.exec(text);
  if (!match) return null;
  return { text: match[0], quoted: false, rest: text.slice(match[0].length) };
}

type ParsedArg =
  | { kind: "column"; column: Fts5Column }
  | { kind: "option"; name: string; value: string };

// FTS5 reads each argument as `word [word]` (a column and its UNINDEXED flag)
// or `bareword = word` (an option). Returns null for anything else.
function parseArg(arg: string): ParsedArg | null {
  const first = readToken(arg);
  if (!first) return null;
  const afterFirst = first.rest.trim();

  if (afterFirst.startsWith("=")) {
    // FTS5 rejects a quoted option name; an empty value is only taken quoted
    if (first.quoted) return null;
    const value = readToken(afterFirst.slice(1));
    if (!value || value.rest.trim() !== "") return null;
    return { kind: "option", name: first.text.toLowerCase(), value: value.text };
  }

  if (afterFirst === "") {
    return { kind: "column", column: { name: first.text, unindexed: false } };
  }
  const flag = readToken(afterFirst);
  if (!flag || flag.rest.trim() !== "" || flag.text.toLowerCase() !== "unindexed") return null;
  return { kind: "column", column: { name: first.text, unindexed: true } };
}

// Whether FTS5 reads the text as a bareword (sqlite3Fts5IsBareword): ASCII
// letters, digits and '_', the 0x1A control character, and any non-ASCII
// character
function isFts5Bareword(text: string): boolean {
  return (
    text.length > 0 &&
    [...text].every((c) => /\w/.test(c) || c.charCodeAt(0) === 0x1a || c.charCodeAt(0) >= 0x80)
  );
}

// FTS5 dequotes each tokenizer word, so 'porter' and porter are the same word.
// A quoted word is kept quoted only when it cannot be written bare.
function canonicalTokenizerWord(word: string): string {
  if (!word.startsWith("'")) return word;
  const text = unquoteIdentifier(word);
  return isFts5Bareword(text) ? text : `'${text.replaceAll("'", "''")}'`;
}

// The words of a tokenize= value: barewords and single-quoted strings,
// separated by whitespace (see canonicalTokenizerWord).
function splitTokenizerWords(value: string): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < value.length) {
    if (/\s/.test(value[i] ?? "")) {
      i++;
      continue;
    }
    const start = i;
    if (value[i] === "'") {
      i = skipQuoted(value, i);
    } else {
      while (i < value.length && !/\s/.test(value[i] ?? "")) i++;
    }
    words.push(canonicalTokenizerWord(value.slice(start, i)));
  }
  return words;
}

/**
 * Normalize a tokenizer specification. Tokenizer names are matched
 * case-insensitively (ASCII only, like SQLite); porter wraps the tokenizer
 * named after it and defaults to unicode61; unicode61 defaults to
 * remove_diacritics 1. Arguments are otherwise kept as written, apart from
 * their quoting.
 */
function normalizeTokenizer(words: readonly string[]): string[] {
  const [name, ...rest] = words;
  if (name === undefined) return [];
  const lowerName = foldName(name);
  if (lowerName === "porter") {
    return ["porter", ...(rest.length === 0 ? [DEFAULT_TOKENIZER] : normalizeTokenizer(rest))];
  }
  if (lowerName === "unicode61") {
    return ["unicode61", ...withoutDefaultUnicode61Options(rest)];
  }
  return [lowerName, ...rest];
}

// unicode61 takes key/value pairs; remove_diacritics 1 is the default
function withoutDefaultUnicode61Options(args: readonly string[]): string[] {
  if (args.length % 2 !== 0) return [...args];
  const result: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i] ?? "";
    const value = args[i + 1] ?? "";
    if (key === "remove_diacritics" && value === "1") continue;
    result.push(key, value);
  }
  return result;
}

function sortPrefixes(prefixes: readonly string[]): string[] {
  return [...new Set(prefixes)].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

export function parseFts5Args(text: string): Fts5Args {
  const columns: Fts5Column[] = [];
  const options = new Map<string, string>();
  const unparsed: string[] = [];
  const prefix: string[] = [];
  let tokenize: string[] | undefined;
  let content: string | undefined;
  let contentRowid: string | undefined;
  let detail = "full";
  let columnsize = "1";

  for (const arg of splitModuleArgs(text)) {
    let parsed: ParsedArg | null;
    try {
      parsed = parseArg(arg);
      if (parsed?.kind === "option" && parsed.name === "tokenize") {
        tokenize = normalizeTokenizer(splitTokenizerWords(parsed.value));
        continue;
      }
    } catch {
      parsed = null;
    }

    if (!parsed) {
      unparsed.push(normalizeSql(arg));
      continue;
    }
    if (parsed.kind === "column") {
      columns.push(parsed.column);
      continue;
    }

    const { name, value } = parsed;
    switch (name) {
      case "prefix":
        prefix.push(...value.split(/[\s,]+/).filter(Boolean));
        break;
      case "content":
        content = value;
        break;
      case "content_rowid":
        contentRowid = value;
        break;
      case "detail":
        detail = value.toLowerCase();
        break;
      case "columnsize":
        columnsize = value;
        break;
      default:
        options.set(name, value);
    }
  }

  let contentMode: Fts5Content;
  if (content === undefined) {
    // content_rowid without content= is accepted and has no effect
    contentMode = { mode: "own" };
  } else if (content === "") {
    contentMode = { mode: "contentless" };
    if (contentRowid !== undefined) options.set("content_rowid", contentRowid);
  } else {
    const rowid =
      contentRowid === undefined || contentRowid.toLowerCase() === "rowid" ? null : contentRowid;
    contentMode = { mode: "external", table: content, rowid };
  }

  return {
    columns,
    content: contentMode,
    tokenize: tokenize ?? [DEFAULT_TOKENIZER],
    prefix: sortPrefixes(prefix),
    detail,
    columnsize,
    options,
    unparsed,
  };
}

function describeColumns(columns: readonly Fts5Column[]): string {
  return `(${columns.map((c) => (c.unindexed ? `${c.name} UNINDEXED` : c.name)).join(", ")})`;
}

function describeContent(content: Fts5Content): string {
  switch (content.mode) {
    case "own":
      return "own content";
    case "contentless":
      return "content=''";
    case "external":
      return `content=${content.table}, content_rowid=${content.rowid ?? "rowid"}`;
  }
}

function contentKey(content: Fts5Content): string {
  if (content.mode !== "external") return content.mode;
  return `external:${foldName(content.table)}:${foldName(content.rowid ?? "rowid")}`;
}

export function diffFts5Args(current: Fts5Args, desired: Fts5Args): RecreateReason[] {
  const reasons: RecreateReason[] = [];
  const changed = (check: string, what: string, from: string, to: string) => {
    if (from !== to) reasons.push({ check: `fts5.${check}`, detail: `${what}: ${from} → ${to}` });
  };

  changed(
    "columns",
    "Columns changed",
    describeColumns(current.columns),
    describeColumns(desired.columns),
  );
  if (contentKey(current.content) !== contentKey(desired.content)) {
    reasons.push({
      check: "fts5.content",
      detail: `Content changed: ${describeContent(current.content)} → ${describeContent(desired.content)}`,
    });
  }
  changed("tokenize", "Tokenizer changed", current.tokenize.join(" "), desired.tokenize.join(" "));
  changed("prefix", "Prefix indexes changed", current.prefix.join(" "), desired.prefix.join(" "));
  changed("detail", "detail changed", current.detail, desired.detail);
  changed("columnsize", "columnsize changed", current.columnsize, desired.columnsize);

  const optionNames = [...new Set([...current.options.keys(), ...desired.options.keys()])].sort();
  for (const name of optionNames) {
    changed(
      `option.${name}`,
      `${name} changed`,
      current.options.get(name) ?? "(not set)",
      desired.options.get(name) ?? "(not set)",
    );
  }

  changed("args", "Arguments changed", current.unparsed.join(", "), desired.unparsed.join(", "));
  return reasons;
}

// contentless_unindexed=1 (SQLite 3.47+) has two bugs on the versions the
// drivers ship (3.49, 3.50): DROP TABLE leaves the %_content shadow table
// behind, which makes creating the table again fail with "table 'x_content'
// already exists", and ALTER TABLE ... RENAME does not rename %_content,
// which breaks the renamed table. The left-over table cannot simply be
// dropped either: in the same connection it still counts as a shadow table,
// and better-sqlite3's defensive mode refuses to drop shadow tables.
function hasContentlessUnindexed(args: Fts5Args): boolean {
  const value = args.options.get("contentless_unindexed");
  return value !== undefined && value !== "0";
}

// Parks the table under a temporary name before dropping it when
// contentless_unindexed is set. After the rename SQLite no longer counts the
// left-over %_content as a shadow table (its virtual table is gone), so it can
// be dropped. legacy_alter_table keeps the rename from rewriting the views and
// triggers that reference the table; it is switched back to its default (OFF)
// for the rest of the migration, and the driver puts back the connection's own
// setting once the migration has run (see preservingLegacyAlterTable in
// driver.ts). On a SQLite without the bugs the rename moves %_content along
// and the final DROP ... IF EXISTS does nothing.
function dropStatements(current: VirtualTable, args: Fts5Args): DDLStatement[] {
  if (!hasContentlessUnindexed(args)) {
    return [`DROP TABLE IF EXISTS ${sql(current.name)};`];
  }
  const parked = `sqlrite_fts5_drop_${current.name}`;
  return [
    "PRAGMA legacy_alter_table = ON;",
    `ALTER TABLE ${sql(current.name)} RENAME TO ${sql(parked)};`,
    "PRAGMA legacy_alter_table = OFF;",
    `DROP TABLE ${sql(parked)};`,
    // Qualified: a bare name drops a temp table of the same name first
    `DROP TABLE IF EXISTS "main".${sql(`${current.name}_content`)};`,
  ];
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// The columns 'rebuild' reads from the content table or view
function contentColumns(args: Fts5Args): string[] {
  if (args.content.mode !== "external") return [];
  const rowid = args.content.rowid;
  return [...args.columns.map((c) => c.name), ...(rowid === null ? [] : [rowid])];
}

// 'rebuild' fails when the content table or view does not exist, lacks one
// of the columns it reads, or has no rowid while content_rowid is omitted (a
// WITHOUT ROWID table, or a view without a column named rowid), which would
// abort the whole migration for a schema that SQLite itself accepts (content=
// is only resolved when the table is read). The guard skips it instead; the
// handler warns about it as far as the desired schema tells. SQLite's lower()
// folds ASCII letters only, like SQLite matches names.
//
// - pragma_table_xinfo lists generated columns, which pragma_table_info
//   leaves out (hidden 2 and 3); FTS5 reads them like any other column
// - the pragmas are given the 'main' schema, where FTS5 reads the content
//   table from: with a bare name they read a temp table of the same name
function rebuildStatement(name: string, args: Fts5Args): DDLStatement {
  invariant(args.content.mode === "external", `FTS5 table "${name}" has no content table`);
  const content = sqlString(args.content.table);
  const columns = [...new Set(contentColumns(args).map(foldName))];
  const list = columns.map(sqlString).join(", ");
  const conditions = [
    `(SELECT count(DISTINCT lower(name)) FROM pragma_table_xinfo(${content}, 'main') WHERE hidden <> 1 AND lower(name) IN (${list})) = ${columns.length}`,
  ];
  if (args.content.rowid === null) {
    conditions.push(
      `(EXISTS (SELECT 1 FROM pragma_table_list(${content}) WHERE schema = 'main' AND type IN ('table', 'shadow') AND wr = 0) OR EXISTS (SELECT 1 FROM pragma_table_xinfo(${content}, 'main') WHERE hidden <> 1 AND lower(name) = 'rowid'))`,
    );
  }
  return `INSERT INTO ${sql(name)}(${sql(name)}) SELECT 'rebuild' WHERE ${conditions.join(" AND ")};`;
}

// A WITHOUT ROWID table has no rowid for FTS5 to read. The table options
// (WITHOUT ROWID, STRICT) follow the closing parenthesis of the definition.
function isWithoutRowid(tableSql: string): boolean {
  return /\)\s*(?:STRICT\s*,\s*)?WITHOUT\s+ROWID\s*(?:,\s*STRICT\s*)?;?\s*$/i.test(tableSql);
}

// The columns the content table lacks in the desired schema, as far as the
// desired schema tells (a view's columns are not introspected). "rowid" is
// missing when content_rowid is omitted and the table is WITHOUT ROWID.
function missingContentColumns(desired: IntrospectionResult, args: Fts5Args): string[] {
  if (args.content.mode !== "external") return [];
  const table = findByName(desired.tables, args.content.table);
  if (!table) return [];
  const have = new Set(
    desired.columns.filter((c) => c.table === table.name).map((c) => foldName(c.name)),
  );
  const missing = contentColumns(args).filter((column) => !have.has(foldName(column)));
  if (args.content.rowid === null && !have.has("rowid") && isWithoutRowid(table.sql)) {
    missing.push("rowid");
  }
  return missing;
}

// How the content table lacks the columns, for the warnings
function describeMissing(missing: readonly string[], table: string): string {
  const columns = missing.filter((c) => c !== "rowid");
  const parts = [
    ...(columns.length > 0
      ? [`column(s) ${columns.map((c) => `"${c}"`).join(", ")}, which "${table}" does not have`]
      : []),
    ...(missing.includes("rowid")
      ? [`the rowid of "${table}", which is WITHOUT ROWID (and content_rowid is not set)`]
      : []),
  ];
  return `${parts.join(", and ")} in the desired schema`;
}

function missingColumnsWarning(
  name: string,
  args: Fts5Args,
  desired: IntrospectionResult,
): MigrationWarning[] {
  const missing = missingContentColumns(desired, args);
  if (missing.length === 0 || args.content.mode !== "external") return [];
  const table = args.content.table;
  return [
    {
      type: "destructive",
      message: `FTS5 table "${name}" reads ${describeMissing(missing, table)}. Its index is not rebuilt: it stays empty and queries that read its rows fail until "${table}" provides them and the index is rebuilt.`,
    },
  ];
}

function findRelation(desired: IntrospectionResult, name: string) {
  return findByName(desired.tables, name) ?? findByName(desired.views, name);
}

type ColumnMapping = { source: string; target: string };

// Where the rows of the recreated table come from
type RowSource =
  // Own content, or external content read from a view: copied out of the old
  // table itself
  | { kind: "copy"; columns: ColumnMapping[] }
  // External content: read from the old table's content table
  | { kind: "content_table"; table: string; rowid: string; columns: ColumnMapping[] }
  // The new table has external content: rebuilt from its content table
  | { kind: "rebuild"; table: string; exists: boolean }
  | { kind: "none"; reason: string };

// Target columns that the current table also has, matched like SQLite
// matches column names (case-insensitively)
function sharedColumns(current: readonly Fts5Column[], target: readonly Fts5Column[]) {
  const byName = new Map(current.map((c) => [foldName(c.name), c.name]));
  return target.flatMap((t): ColumnMapping[] => {
    const source = byName.get(foldName(t.name));
    return source === undefined ? [] : [{ source, target: t.name }];
  });
}

function droppedColumns(current: readonly Fts5Column[], target: readonly Fts5Column[]) {
  const kept = new Set(target.map((c) => foldName(c.name)));
  return current.filter((c) => !kept.has(foldName(c.name))).map((c) => c.name);
}

function planRows(
  current: VirtualTable,
  currentArgs: Fts5Args,
  targetArgs: Fts5Args,
  desired: IntrospectionResult,
  renamedTables: ReadonlyMap<string, string> = new Map(),
): RowSource {
  if (targetArgs.content.mode === "external") {
    const table = targetArgs.content.table;
    return { kind: "rebuild", table, exists: findRelation(desired, table) !== undefined };
  }

  const columns = sharedColumns(currentArgs.columns, targetArgs.columns);

  switch (currentArgs.content.mode) {
    case "contentless": {
      // contentless_unindexed=1 stores the UNINDEXED columns (they can be
      // read back); the indexed ones never are, so the rows are not copied
      const unindexed = hasContentlessUnindexed(currentArgs)
        ? currentArgs.columns.filter((c) => c.unindexed).map((c) => `"${c.name}"`)
        : [];
      return {
        kind: "none",
        reason:
          unindexed.length > 0
            ? `"${current.name}" is contentless: its indexed columns are not stored, and the values stored for its UNINDEXED column(s) ${unindexed.join(", ")} are not copied`
            : `"${current.name}" is contentless, so its column values cannot be read back`,
      };
    }

    case "own":
      if (columns.length === 0) {
        return { kind: "none", reason: `no column of "${current.name}" is kept` };
      }
      return { kind: "copy", columns };

    case "external": {
      // The content table is read once every table operation has run, so it
      // must exist in the desired schema (under its new name when this
      // migration renames it), with the columns being read
      const { table: currentName, rowid } = currentArgs.content;
      const name = renamedTables.get(foldName(currentName)) ?? currentName;
      const table = findByName(desired.tables, name);
      if (!table && name === currentName && findByName(desired.views, name)) {
        // A view is read through the current table before it is dropped (see
        // dropFirst), while the view is still as it was
        if (columns.length === 0) {
          return { kind: "none", reason: `no column of "${current.name}" is kept` };
        }
        return { kind: "copy", columns };
      }
      if (!table) {
        return {
          kind: "none",
          reason: `its content table "${name}" is not a table in the desired schema`,
        };
      }
      const tableColumns = new Set(
        desired.columns.filter((c) => c.table === table.name).map((c) => foldName(c.name)),
      );
      if (rowid !== null && !tableColumns.has(foldName(rowid))) {
        return {
          kind: "none",
          reason: `its content table "${name}" has no column "${rowid}" (content_rowid)`,
        };
      }
      const readable = columns.filter((c) => tableColumns.has(foldName(c.source)));
      if (readable.length === 0) {
        return {
          kind: "none",
          reason: `its content table "${name}" has none of the columns that are kept`,
        };
      }
      return {
        kind: "content_table",
        table: table.name,
        rowid: rowid ?? "rowid",
        columns: readable,
      };
    }
  }
}

function tempName(kind: "rows" | "config", table: string): string {
  return `temp.${sql(`sqlrite_fts5_${kind}_${table}`)}`;
}

function insertRows(
  target: string,
  columns: ColumnMapping[],
  rowid: string,
  from: string,
  source: (column: ColumnMapping, index: number) => string = (c) => sql(c.source),
) {
  const targets = columns.map((c) => sql(c.target)).join(", ");
  const sources = columns.map(source).join(", ");
  return `INSERT INTO ${sql(target)}(rowid, ${targets}) SELECT ${rowid}, ${sources} FROM ${from};`;
}

// locale=1 (SQLite 3.47+) stores a locale with each value, set with
// fts5_locale() and read back with fts5_get_locale(); a plain SELECT returns
// the text alone
function hasLocale(args: Fts5Args): boolean {
  const value = args.options.get("locale");
  return value !== undefined && value !== "0";
}

// Rows copied out of an own-content locale=1 table keep each value's locale
// (in a column of the copy), unless the new table cannot store it
function copiesLocales(currentArgs: Fts5Args, targetArgs: Fts5Args): boolean {
  return currentArgs.content.mode === "own" && hasLocale(currentArgs) && hasLocale(targetArgs);
}

function localeColumn(index: number): string {
  return sql(`sqlrite_fts5_locale_${index}`);
}

/**
 * The rank setting may pass bm25() a weight per column, by column position.
 * When the columns move, the weights are moved with them in the copied
 * settings: each target column gets the weight of the current column of the
 * same name, or bm25's default 1.0 (a new column, or no weight given). Other
 * rank functions are copied as they are.
 */
function remapRankWeights(
  config: string,
  current: readonly Fts5Column[],
  target: readonly Fts5Column[],
): DDLStatement[] {
  const positions = new Map(current.map((c, i) => [foldName(c.name), i]));
  const sources = target.map((c) => positions.get(foldName(c.name)) ?? null);
  // Weights beyond the last column are ignored, and a missing weight is 1.0,
  // so columns only added or removed at the end change nothing
  const unchanged = sources.every(
    (source, i) => source === i || (source === null && i >= current.length),
  );
  if (unchanged) return [];

  const map = sources.map((source, i) => `(${i}, ${source ?? "NULL"})`).join(", ");
  const value = "trim(v)";
  const open = `instr(${value}, '(')`;
  return [
    `UPDATE ${config} SET v = (WITH RECURSIVE args(n, rest, weight) AS (SELECT -1, substr(${value}, ${open} + 1, length(${value}) - ${open} - 1) || ',', NULL FROM ${config} WHERE k = 'rank' UNION ALL SELECT n + 1, substr(rest, instr(rest, ',') + 1), trim(substr(rest, 1, instr(rest, ',') - 1)) FROM args WHERE rest <> ''), map(pos, source) AS (VALUES ${map}) SELECT 'bm25(' || group_concat(coalesce((SELECT weight FROM args WHERE n = map.source AND weight <> ''), '1.0'), ', ' ORDER BY pos) || ')' FROM map) WHERE k = 'rank' AND lower(trim(substr(${value}, 1, ${open} - 1))) = 'bm25' AND ${value} LIKE '%)';`,
  ];
}

// The data carried across a recreate is taken out of the current table (and
// its %_config settings) into temp tables before it is dropped, and put back
// once the new table is created
function recreateSteps({
  current,
  target,
  currentArgs,
  targetArgs,
  desired,
  renamedTables,
}: VirtualTableRecreateContext<Fts5Args>): { drop: DDLStatement[]; create: DDLStatement[] } {
  const rows = planRows(current, currentArgs, targetArgs, desired, renamedTables);
  const config = tempName("config", target.name);
  const copy = tempName("rows", target.name);
  const drop: DDLStatement[] = [
    `CREATE TEMP TABLE ${config} AS SELECT k, v FROM ${sql(`${current.name}_config`)} WHERE k <> 'version';`,
    ...remapRankWeights(config, currentArgs.columns, targetArgs.columns),
  ];

  const locales = rows.kind === "copy" && copiesLocales(currentArgs, targetArgs);
  if (rows.kind === "copy") {
    const positions = new Map(currentArgs.columns.map((c, i) => [foldName(c.name), i]));
    const sources = rows.columns.map((c, i) => {
      if (!locales) return sql(c.source);
      const position = positions.get(foldName(c.source)) ?? 0;
      return `${sql(c.source)}, fts5_get_locale(${sql(current.name)}, ${position}) AS ${localeColumn(i)}`;
    });
    drop.push(
      `CREATE TEMP TABLE ${copy} AS SELECT rowid AS "rowid", ${sources.join(", ")} FROM ${sql(current.name)};`,
    );
  }
  drop.push(...dropStatements(current, currentArgs));

  const create: DDLStatement[] = [
    ensureSemicolon(target.sql),
    // Runtime settings first: some of them (pgsz, automerge, ...) govern how
    // the rows below are written
    `INSERT INTO ${sql(target.name)}(${sql(target.name)}, rank) SELECT k, v FROM ${config};`,
    `DROP TABLE ${config};`,
  ];

  switch (rows.kind) {
    case "copy":
      // CREATE TABLE ... AS SELECT rowid AS "rowid" declares a column named
      // rowid, which "rowid" then refers to. FTS5 reserves the name, so it
      // cannot collide with a copied column.
      // fts5_locale(NULL, value) is the plain value
      create.push(
        insertRows(target.name, rows.columns, '"rowid"', copy, (c, i) =>
          locales ? `fts5_locale(${localeColumn(i)}, ${sql(c.source)})` : sql(c.source),
        ),
        `DROP TABLE ${copy};`,
      );
      break;
    case "content_table":
      create.push(insertRows(target.name, rows.columns, sql(rows.rowid), sql(rows.table)));
      break;
    case "rebuild":
      create.push(rebuildStatement(target.name, targetArgs));
      break;
    case "none":
      break;
  }

  return { drop, create };
}

export const fts5Module: VirtualTableModule<Fts5Args> = {
  name: "fts5",

  parseArgs: parseFts5Args,

  diff: diffFts5Args,

  supportsRename: true,

  canRename(_current, args) {
    return !hasContentlessUnindexed(args);
  },

  dependencies(_target, args) {
    return args.content.mode === "external" ? [args.content.table] : [];
  },

  shadowTables(args) {
    // %_content only stores the rows of an own-content table, and the
    // UNINDEXED values of a contentless_unindexed one; %_docsize only exists
    // with columnsize=1 (the default)
    const content =
      args.content.mode === "own" ||
      (args.content.mode === "contentless" && hasContentlessUnindexed(args));
    return [
      "data",
      "idx",
      "config",
      ...(content ? ["content"] : []),
      ...(args.columnsize !== "0" ? ["docsize"] : []),
    ];
  },

  create(target, args) {
    // An external-content index is empty until it is rebuilt, even when its
    // content table already holds rows
    const create = ensureSemicolon(target.sql);
    if (args.content.mode !== "external") return [create];
    return [create, rebuildStatement(target.name, args)];
  },

  drop(current, args) {
    return dropStatements(current, args);
  },

  recreate(ctx) {
    const { drop, create } = recreateSteps(ctx);
    return [...drop, ...create];
  },

  recreateSteps,

  dropFirst({ current, currentArgs, targetArgs, desired, renamedTables }) {
    // Rows copied out of an external-content table are read from its content
    // view (see planRows), which the migration may drop or change
    return (
      currentArgs.content.mode === "external" &&
      planRows(current, currentArgs, targetArgs, desired, renamedTables).kind === "copy"
    );
  },

  rebuild({ target, args }) {
    if (args.content.mode !== "external") return [];
    return [rebuildStatement(target.name, args)];
  },

  onDependencyChanged({ args, change }) {
    if (args.content.mode !== "external") return "none";
    // A recreated content table may have renumbered rowids (a table without an
    // INTEGER PRIMARY KEY), which leaves the index pointing at the wrong rows.
    // A renamed one is no longer found under the name stored in content=.
    return change === "recreated" ? "rebuild" : "recreate";
  },

  warnings({ op, currentArgs, targetArgs, desired, renamedTables }) {
    const current = (vt: VirtualTable) => currentArgs ?? parseFts5Args(vt.args);
    const target = (vt: VirtualTable) => targetArgs ?? parseFts5Args(vt.args);
    const missingContentTable = (name: string, args: Fts5Args): MigrationWarning[] => {
      if (args.content.mode !== "external") return [];
      const table = args.content.table;
      if (findRelation(desired, table)) return [];
      return [
        {
          type: "destructive",
          message: `FTS5 table "${name}" reads from "${table}", which does not exist in the desired schema. Its index stays empty and queries that read its rows fail until "${table}" exists and the index is rebuilt.`,
        },
      ];
    };

    switch (op.type) {
      case "create": {
        const args = target(op.target);
        return [
          ...missingContentTable(op.target.name, args),
          ...missingColumnsWarning(op.target.name, args, desired),
        ];
      }

      case "rename":
        return [];

      case "drop": {
        const { content } = current(op.current);
        if (content.mode === "external") {
          return [
            {
              type: "caution",
              message: `FTS5 table "${op.current.name}" will be dropped. Its content table "${content.table}" is not modified.`,
            },
          ];
        }
        return [
          {
            type: "destructive",
            message: `Virtual table "${op.current.name}" will be dropped. Data in virtual table "${op.current.name}" will be lost.`,
          },
        ];
      }

      case "rebuild": {
        const args = target(op.target);
        if (args.content.mode !== "external") return [];
        const missing = missingContentColumns(desired, args);
        if (missing.length > 0) {
          return [
            {
              type: "destructive",
              message: `FTS5 table "${op.target.name}" should be rebuilt from its content table "${args.content.table}", but it reads ${describeMissing(missing, args.content.table)}. The index is not rebuilt, and queries that read its rows fail until "${args.content.table}" provides them and the index is rebuilt.`,
            },
          ];
        }
        return [
          {
            type: "caution",
            message: `FTS5 table "${op.target.name}" will be rebuilt from its content table "${args.content.table}".`,
          },
        ];
      }

      case "recreate":
        return recreateWarnings(
          op.current,
          op.target,
          current(op.current),
          target(op.target),
          desired,
          renamedTables,
        );
    }
  },
};

// A contentless table does not store the values of its columns, so they can
// no longer be read back through it, whether the rows were copied out of the
// old table or read from its content table (where they stay).
// contentless_unindexed=1 does store the values of the UNINDEXED columns.
function contentlessWarnings(
  name: string,
  rows: RowSource & { kind: "copy" | "content_table" },
  targetArgs: Fts5Args,
): MigrationWarning[] {
  const stored = new Set(
    hasContentlessUnindexed(targetArgs)
      ? targetArgs.columns.filter((c) => c.unindexed).map((c) => foldName(c.name))
      : [],
  );
  const filled = rows.columns.map((c) => c.target);
  const lost = filled.filter((c) => !stored.has(foldName(c)));
  if (lost.length === 0) return [];
  const kept = filled.filter((c) => stored.has(foldName(c)));
  const quote = (columns: string[]) => columns.map((c) => `"${c}"`).join(", ");
  const values =
    kept.length > 0 ? `the values of its indexed column(s) ${quote(lost)}` : "their column values";
  const unreadable =
    rows.kind === "content_table"
      ? `Its rows are read from "${rows.table}" and indexed again, but ${values} cannot be read back through it (they stay in "${rows.table}")`
      : `Its rows are indexed again, but ${values} are no longer stored and cannot be read back`;
  const stays =
    kept.length > 0 ? `; the values of its UNINDEXED column(s) ${quote(kept)} are kept` : "";
  return [
    {
      type: "destructive",
      message: `FTS5 table "${name}" will be recreated as a contentless table. ${unreadable}${stays}.`,
    },
  ];
}

function recreateWarnings(
  current: VirtualTable,
  target: VirtualTable,
  currentArgs: Fts5Args,
  targetArgs: Fts5Args,
  desired: IntrospectionResult,
  renamedTables?: ReadonlyMap<string, string>,
): MigrationWarning[] {
  const rows = planRows(current, currentArgs, targetArgs, desired, renamedTables);
  const name = target.name;

  if (rows.kind === "none") {
    return [
      {
        type: "destructive",
        message: `FTS5 table "${name}" will be recreated. Data in virtual table "${current.name}" will be lost: ${rows.reason}. The new table stays empty until the application fills it again.`,
      },
    ];
  }

  if (rows.kind === "rebuild") {
    if (!rows.exists) {
      return [
        {
          type: "destructive",
          message: `FTS5 table "${name}" will be recreated, but its content table "${rows.table}" does not exist in the desired schema. Its index stays empty and queries that read its rows fail until "${rows.table}" exists and the index is rebuilt.`,
        },
      ];
    }
    const missing = missingColumnsWarning(name, targetArgs, desired);
    if (missing.length > 0) {
      return [
        ...(currentArgs.content.mode === "external"
          ? []
          : [
              {
                type: "destructive" as const,
                message: `FTS5 table "${name}" will be recreated with external content. Data in virtual table "${current.name}" will be lost: the rows it stores are not copied.`,
              },
            ]),
        ...missing,
      ];
    }
    if (currentArgs.content.mode === "own") {
      return [
        {
          type: "destructive",
          message: `FTS5 table "${name}" will be recreated with external content. Data in virtual table "${current.name}" will be lost: the rows it stores are not copied, and it will index the rows of "${rows.table}" instead.`,
        },
      ];
    }
    return [
      {
        type: "caution",
        message: `FTS5 table "${name}" will be recreated and rebuilt from its content table "${rows.table}".`,
      },
    ];
  }

  const warnings: MigrationWarning[] = [];
  const dropped =
    rows.kind === "copy" ? droppedColumns(currentArgs.columns, targetArgs.columns) : [];
  if (dropped.length > 0) {
    warnings.push({
      type: "destructive",
      message: `FTS5 table "${name}" will be recreated. Column(s) ${dropped.map((c) => `"${c}"`).join(", ")} will be dropped. Data in these columns will be lost.`,
    });
  }
  if (targetArgs.content.mode === "contentless") {
    warnings.push(...contentlessWarnings(name, rows, targetArgs));
  }
  if (
    rows.kind === "copy" &&
    currentArgs.content.mode === "own" &&
    hasLocale(currentArgs) &&
    !hasLocale(targetArgs)
  ) {
    warnings.push({
      type: "destructive",
      message: `FTS5 table "${name}" will be recreated without locale=1. Its rows are copied, but the locale stored with each value (fts5_locale) is lost.`,
    });
  }
  if (warnings.length === 0) {
    const from = rows.kind === "copy" ? "copied" : `read from "${rows.table}"`;
    warnings.push({
      type: "caution",
      message: `FTS5 table "${name}" will be recreated. Its rows are ${from} with their rowids and indexed again.`,
    });
  }
  return warnings;
}
