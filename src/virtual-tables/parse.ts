// Parsing helpers for CREATE VIRTUAL TABLE statements.
//
// SQLite stores the statement with its prefix rewritten to exactly
// `CREATE VIRTUAL TABLE ` (IF NOT EXISTS, a schema qualifier and surrounding
// comments are stripped), but everything from the table name onward is kept
// verbatim: the name's quoting, the case of USING and of the module name,
// whitespace, newlines and argument quoting. After ALTER TABLE ... RENAME the
// name token becomes double-quoted. The parser therefore has to cope with any
// identifier quoting and arbitrary whitespace, and returns the module
// arguments as raw text for the module handler to interpret.

import { foldName } from "../utils";

export type VirtualTableDefinition = {
  name: string;
  module: string;
  /** Raw text between the parentheses after the module name ("" when there are none) */
  args: string;
};

const QUOTE_CLOSE: Record<string, string> = { '"': '"', "'": "'", "`": "`", "[": "]" };

// As in SQLite's tokenizer: whitespace is ASCII only, and an unquoted
// identifier is made of ASCII letters, digits, '_', '$' and every non-ASCII
// character (SQLite treats each byte >= 0x80 as an identifier character, so a
// no-break space is part of a name, not whitespace). Anything else, including
// the start of a comment ('--', '/*'), ends an identifier.
const WHITESPACE = /^[ \t\n\f\r]+/;
const IDENTIFIER = /^(?:[A-Za-z0-9_$]|\P{ASCII})+/u;
const IDENTIFIER_CHAR = /^(?:[A-Za-z0-9_$]|\P{ASCII})/u;

class Scanner {
  pos = 0;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  skipTrivia(): void {
    while (this.pos < this.text.length) {
      const rest = this.text.slice(this.pos);
      const ws = WHITESPACE.exec(rest);
      if (ws) {
        this.pos += ws[0].length;
      } else if (rest.startsWith("--")) {
        const end = this.text.indexOf("\n", this.pos);
        this.pos = end === -1 ? this.text.length : end + 1;
      } else if (rest.startsWith("/*")) {
        const end = this.text.indexOf("*/", this.pos + 2);
        this.pos = end === -1 ? this.text.length : end + 2;
      } else {
        return;
      }
    }
  }

  keyword(word: string): boolean {
    this.skipTrivia();
    const candidate = this.text.slice(this.pos, this.pos + word.length);
    const next = this.text[this.pos + word.length] ?? "";
    if (candidate.toLowerCase() === word.toLowerCase() && !IDENTIFIER_CHAR.test(next)) {
      this.pos += word.length;
      return true;
    }
    return false;
  }

  expectKeyword(word: string): void {
    if (!this.keyword(word)) {
      throw new SyntaxError(`Expected ${word} at offset ${this.pos} in: ${this.text}`);
    }
  }

  identifier(): string {
    this.skipTrivia();
    const start = this.pos;
    const first = this.text[start];
    if (first === undefined) {
      throw new SyntaxError(`Expected an identifier at end of: ${this.text}`);
    }
    const close = QUOTE_CLOSE[first];
    if (close) {
      this.pos = skipQuoted(this.text, start);
      return unquoteIdentifier(this.text.slice(start, this.pos));
    }
    const match = IDENTIFIER.exec(this.text.slice(start));
    if (!match) {
      throw new SyntaxError(`Expected an identifier at offset ${start} in: ${this.text}`);
    }
    this.pos += match[0].length;
    return match[0];
  }

  peek(): string | undefined {
    this.skipTrivia();
    return this.text[this.pos];
  }
}

/**
 * Returns the index just past the quoted token starting at `start`. A doubled
 * closing quote inside '..', ".." or `..` is an escaped quote; [..] has no
 * escape.
 */
export function skipQuoted(text: string, start: number): number {
  const open = text[start] ?? "";
  const close = QUOTE_CLOSE[open];
  if (!close) return start;
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === close) {
      if (open !== "[" && text[i + 1] === close) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  throw new SyntaxError(`Unterminated ${open} quote at offset ${start} in: ${text}`);
}

/**
 * When `i` starts a quoted token or a comment, the index just past it;
 * otherwise `i`. SQLite stores module arguments verbatim, comments included,
 * so a parenthesis or comma inside either must not be taken as syntax.
 */
function skipLiteralOrComment(text: string, i: number): number {
  const ch = text[i] ?? "";
  if (QUOTE_CLOSE[ch]) return skipQuoted(text, i);
  if (text.startsWith("--", i)) {
    const end = text.indexOf("\n", i);
    return end === -1 ? text.length : end + 1;
  }
  if (text.startsWith("/*", i)) {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return i;
}

/**
 * Strip SQL identifier/string quoting ("x", `x`, [x], 'x') and unescape doubled
 * quotes. Unquoted text is returned unchanged.
 */
export function unquoteIdentifier(token: string): string {
  const open = token[0] ?? "";
  const close = QUOTE_CLOSE[open];
  if (!close || token.length < 2 || !token.endsWith(close)) return token;
  const inner = token.slice(1, -1);
  return open === "[" ? inner : inner.replaceAll(close + close, close);
}

/**
 * Parse `CREATE VIRTUAL TABLE [IF NOT EXISTS] [schema.]name USING module[(args)]`.
 * Throws a SyntaxError when the text is not a CREATE VIRTUAL TABLE statement.
 */
export function parseCreateVirtualTable(sql: string): VirtualTableDefinition {
  const scanner = new Scanner(sql);
  scanner.expectKeyword("CREATE");
  scanner.expectKeyword("VIRTUAL");
  scanner.expectKeyword("TABLE");
  if (scanner.keyword("IF")) {
    scanner.expectKeyword("NOT");
    scanner.expectKeyword("EXISTS");
  }

  let name = scanner.identifier();
  if (scanner.peek() === ".") {
    scanner.pos++;
    name = scanner.identifier();
  }

  scanner.expectKeyword("USING");
  const module = scanner.identifier();

  let args = "";
  if (scanner.peek() === "(") {
    const open = scanner.pos;
    const close = findClosingParen(sql, open);
    args = sql.slice(open + 1, close);
  }

  return { name, module, args };
}

/**
 * Replace the table name in `CREATE [TEMP] TABLE [IF NOT EXISTS] [schema.]name ...`
 * with `replacement`, whatever the name's quoting ('x', "x", `x`, [x] or bare).
 * Throws a SyntaxError when the text is not a CREATE TABLE statement.
 */
export function replaceCreateTableName(sql: string, replacement: string): string {
  const scanner = new Scanner(sql);
  scanner.expectKeyword("CREATE");
  if (!scanner.keyword("TEMP")) scanner.keyword("TEMPORARY");
  scanner.expectKeyword("TABLE");
  if (scanner.keyword("IF")) {
    scanner.expectKeyword("NOT");
    scanner.expectKeyword("EXISTS");
  }

  scanner.skipTrivia();
  const start = scanner.pos;
  scanner.identifier();
  let end = scanner.pos;
  if (scanner.peek() === ".") {
    scanner.pos++;
    scanner.identifier();
    end = scanner.pos;
  }
  return `${sql.slice(0, start)}${replacement}${sql.slice(end)}`;
}

/**
 * Split `CREATE TABLE name (item, ...) options` into its items (column
 * definitions and table constraints, trimmed) and the table options after the
 * closing parenthesis (STRICT, WITHOUT ROWID; trimmed). Throws a SyntaxError
 * when the text is not a CREATE TABLE statement with a column list.
 */
export function splitCreateTable(sql: string): { items: string[]; options: string } {
  const scanner = new Scanner(sql);
  scanner.expectKeyword("CREATE");
  if (!scanner.keyword("TEMP")) scanner.keyword("TEMPORARY");
  scanner.expectKeyword("TABLE");
  if (scanner.keyword("IF")) {
    scanner.expectKeyword("NOT");
    scanner.expectKeyword("EXISTS");
  }
  scanner.identifier();
  if (scanner.peek() === ".") {
    scanner.pos++;
    scanner.identifier();
  }
  if (scanner.peek() !== "(") {
    throw new SyntaxError(`Expected a column list at offset ${scanner.pos} in: ${sql}`);
  }
  const open = scanner.pos;
  const close = findClosingParen(sql, open);
  return {
    items: splitModuleArgs(sql.slice(open + 1, close)),
    options: sql.slice(close + 1).trim(),
  };
}

/** The first token of `text` when it is an identifier (unquoted), else undefined */
export function leadingIdentifier(text: string): string | undefined {
  try {
    return new Scanner(text).identifier();
  } catch {
    return undefined;
  }
}

/**
 * Replace every identifier token naming `from` (in any quoting, case folded
 * as SQLite does) with `to`, double-quoted. String literals and comments are
 * left alone. This is what ALTER TABLE RENAME COLUMN does to the column
 * definitions and constraints of the table.
 */
export function renameIdentifier(text: string, from: string, to: string): string {
  const target = foldName(from);
  const replacement = `"${to.replaceAll('"', '""')}"`;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === "'" || text.startsWith("--", i) || text.startsWith("/*", i)) {
      const end = skipLiteralOrComment(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    let end = i;
    if (QUOTE_CLOSE[ch]) {
      end = skipQuoted(text, i);
    } else {
      const match = IDENTIFIER.exec(text.slice(i));
      if (match) end = i + match[0].length;
    }
    if (end === i) {
      out += ch;
      i++;
      continue;
    }
    const token = text.slice(i, end);
    out += foldName(unquoteIdentifier(token)) === target ? replacement : token;
    i = end;
  }
  return out;
}

/** Index of the parenthesis that closes the one at `open`, skipping quotes and comments. */
function findClosingParen(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = text[i];
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  throw new SyntaxError(`Unbalanced parentheses at offset ${open} in: ${text}`);
}

/**
 * Split module arguments at top-level commas, ignoring commas inside quotes,
 * comments or nested parentheses. Each part is trimmed (comments are kept);
 * an empty argument list yields [].
 */
export function splitModuleArgs(args: string): string[] {
  if (args.trim() === "") return [];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < args.length) {
    const skipped = skipLiteralOrComment(args, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = args[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  parts.push(args.slice(start).trim());
  return parts;
}
