import { describe, expect, it } from "vitest";
import {
  parseCreateVirtualTable,
  replaceCreateTableName,
  splitModuleArgs,
  unquoteIdentifier,
} from "./parse";

describe("parseCreateVirtualTable", () => {
  it("parses the stored form of a simple statement", () => {
    expect(parseCreateVirtualTable("CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX)")).toEqual({
      name: "rt",
      module: "rtree",
      args: "id, minX, maxX",
    });
  });

  it("parses the double-quoted name SQLite writes after ALTER TABLE ... RENAME", () => {
    expect(parseCreateVirtualTable('CREATE VIRTUAL TABLE "b1" USING fts5(title, body)')).toEqual({
      name: "b1",
      module: "fts5",
      args: "title, body",
    });
  });

  it.each([
    ["`a6`", "a6"],
    ["[a7]", "a7"],
    ['"b 2"', "b 2"],
    ['"we""ird"', 'we"ird'],
    ["'single'", "single"],
  ])("unquotes the name %s", (token, name) => {
    expect(parseCreateVirtualTable(`CREATE VIRTUAL TABLE ${token} USING fts5(x)`).name).toBe(name);
  });

  it("keeps the module name and arguments as written", () => {
    expect(
      parseCreateVirtualTable(
        "CREATE VIRTUAL TABLE a2   using   FTS5 ( title ,  body , tokenize = 'porter unicode61' )",
      ),
    ).toEqual({
      name: "a2",
      module: "FTS5",
      args: " title ,  body , tokenize = 'porter unicode61' ",
    });
  });

  it("accepts IF NOT EXISTS, a schema qualifier, lowercase keywords and comments", () => {
    expect(
      parseCreateVirtualTable(
        "  /* lead */ create virtual table if not exists main.docs using fts5(x) -- trailing",
      ),
    ).toEqual({ name: "docs", module: "fts5", args: "x" });
  });

  it("returns empty args when the module has no argument list", () => {
    expect(parseCreateVirtualTable("CREATE VIRTUAL TABLE s USING dbstat")).toEqual({
      name: "s",
      module: "dbstat",
      args: "",
    });
  });

  it("finds the closing parenthesis past quoted and nested parentheses", () => {
    const sql =
      "CREATE VIRTUAL TABLE v USING vec0(embedding float[4], tag text, note='a ) b', f(x(1)))";
    expect(parseCreateVirtualTable(sql).args).toBe(
      "embedding float[4], tag text, note='a ) b', f(x(1))",
    );
  });

  it("does not stop at a parenthesis inside a comment in the arguments", () => {
    // SQLite stores this verbatim, comments included
    expect(
      parseCreateVirtualTable("CREATE VIRTUAL TABLE c USING fts5(a, -- note )\n b /* ) */)").args,
    ).toBe("a, -- note )\n b /* ) */");
  });

  it("keeps newlines inside the arguments", () => {
    expect(parseCreateVirtualTable("CREATE VIRTUAL TABLE m USING fts5(\n  a,\n  b\n)").args).toBe(
      "\n  a,\n  b\n",
    );
  });

  it("ends a bare name or module name at a comment that touches it", () => {
    // SQLite keeps everything from the name onward verbatim, comments included
    expect(
      parseCreateVirtualTable("CREATE VIRTUAL TABLE docs-- full-text index\nUSING fts5(body)"),
    ).toEqual({ name: "docs", module: "fts5", args: "body" });
    expect(
      parseCreateVirtualTable("CREATE VIRTUAL TABLE docs/* search */ USING fts5(body)"),
    ).toEqual({ name: "docs", module: "fts5", args: "body" });
    expect(
      parseCreateVirtualTable("CREATE VIRTUAL TABLE docs USING fts5/* search */(body)"),
    ).toEqual({ name: "docs", module: "fts5", args: "body" });
  });

  it.each([0xa0, 0x3000, 0xfeff, 0x2003])(
    "keeps the non-ASCII character U+%s inside a bare name, as SQLite does",
    (code) => {
      const name = `t${String.fromCharCode(code)}x`;
      expect(parseCreateVirtualTable(`CREATE VIRTUAL TABLE ${name} USING fts5(a)`)).toEqual({
        name,
        module: "fts5",
        args: "a",
      });
    },
  );

  it("throws for a statement that is not CREATE VIRTUAL TABLE", () => {
    expect(() => parseCreateVirtualTable("CREATE TABLE t (id)")).toThrow(SyntaxError);
  });

  it("throws for unbalanced parentheses", () => {
    expect(() => parseCreateVirtualTable("CREATE VIRTUAL TABLE t USING fts5(a, b")).toThrow(
      SyntaxError,
    );
  });
});

describe("replaceCreateTableName", () => {
  it.each([
    ["CREATE TABLE q (id)", 'CREATE TABLE "temp_q" (id)'],
    ["CREATE TABLE 'q' (id)", 'CREATE TABLE "temp_q" (id)'],
    ['CREATE TABLE "q"(id)', 'CREATE TABLE "temp_q"(id)'],
    ["CREATE TABLE `q` (id)", 'CREATE TABLE "temp_q" (id)'],
    ["CREATE TABLE [q] (id)", 'CREATE TABLE "temp_q" (id)'],
    ["create table if not exists main.'q' (id)", 'create table if not exists "temp_q" (id)'],
    ["CREATE TEMP TABLE q (q_id)", 'CREATE TEMP TABLE "temp_q" (q_id)'],
  ])("replaces the name in %s", (sqlText, expected) => {
    expect(replaceCreateTableName(sqlText, '"temp_q"')).toBe(expected);
  });

  it("throws for a statement that is not CREATE TABLE", () => {
    expect(() => replaceCreateTableName("CREATE VIEW v AS SELECT 1", "x")).toThrow(SyntaxError);
  });
});

describe("splitModuleArgs", () => {
  it("splits at top-level commas and trims", () => {
    expect(splitModuleArgs(" a , b UNINDEXED,c ")).toEqual(["a", "b UNINDEXED", "c"]);
  });

  it("ignores commas inside quotes and parentheses", () => {
    expect(splitModuleArgs("a, prefix='2,3', \"x,y\", f(1, 2), [p,q]")).toEqual([
      "a",
      "prefix='2,3'",
      '"x,y"',
      "f(1, 2)",
      "[p,q]",
    ]);
  });

  it("ignores commas inside comments", () => {
    expect(splitModuleArgs("a -- x, y\n, b /* p, q */")).toEqual(["a -- x, y", "b /* p, q */"]);
  });

  it("handles escaped quotes", () => {
    expect(splitModuleArgs("tokenize = 'unicode61 tokenchars ''-,_''', b")).toEqual([
      "tokenize = 'unicode61 tokenchars ''-,_'''",
      "b",
    ]);
  });

  it("returns [] for an empty argument list", () => {
    expect(splitModuleArgs("  ")).toEqual([]);
  });
});

describe("unquoteIdentifier", () => {
  it.each([
    ['"a"', "a"],
    ["`a`", "a"],
    ["[a]", "a"],
    ["'a'", "a"],
    ["'it''s'", "it's"],
    ["plain", "plain"],
    ['"', '"'],
  ])("%s -> %s", (token, expected) => {
    expect(unquoteIdentifier(token)).toBe(expected);
  });
});
