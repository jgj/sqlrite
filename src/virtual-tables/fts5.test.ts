import { describe, expect, it } from "vitest";
import type { Column, IntrospectionResult, VirtualTable } from "../introspection-result";
import type { VirtualTableRecreateOperation } from "../migration-operation";
import { emptyIntrospection } from "../test-utils";
import { fts5Module, parseFts5Args } from "./fts5";
import { getVirtualTableModule } from "./registry";

function fts(name: string, args: string): VirtualTable {
  return {
    type: "virtual_table",
    name,
    module: "fts5",
    args,
    sql: `CREATE VIRTUAL TABLE ${name} USING fts5(${args})`,
  };
}

function column(table: string, name: string, position: number): Column {
  return {
    type: "column",
    table,
    name,
    data_type: "text",
    ordinal_position: position,
    nullable: true,
    character_maximum_length: null,
    precision: null,
    default: "",
    check_constraint: null,
    autoincrement: false,
    generated: "none",
  };
}

// A desired schema holding one regular table with the given columns
function schemaWith(table: string, columns: string[]): IntrospectionResult {
  return {
    ...emptyIntrospection(),
    tables: [
      { type: "table", name: table, sql: `CREATE TABLE ${table} (...)`, views: [], num_cols: 1 },
    ],
    columns: columns.map((c, i) => column(table, c, i)),
  };
}

const none = emptyIntrospection();

function differences(a: string, b: string) {
  return fts5Module.diff(parseFts5Args(a), parseFts5Args(b));
}

function recreate(current: VirtualTable, target: VirtualTable, desired = none) {
  return fts5Module.recreate({
    current,
    target,
    currentArgs: parseFts5Args(current.args),
    targetArgs: parseFts5Args(target.args),
    desired,
  });
}

function recreateWarnings(current: VirtualTable, target: VirtualTable, desired = none) {
  const op: VirtualTableRecreateOperation = { type: "recreate", current, target, reasons: [] };
  return fts5Module.warnings({ op, desired });
}

describe("fts5 module", () => {
  it("is registered for fts5, case-insensitively", () => {
    expect(getVirtualTableModule("fts5")).toBe(fts5Module);
    expect(getVirtualTableModule("FTS5")).toBe(fts5Module);
  });

  describe("parseArgs", () => {
    it("reads columns with their UNINDEXED flag, unquoting the names", () => {
      const args = parseFts5Args(
        `"a", [b] UNINDEXED, \`c\` "unindexed", 'd', "my col" UnIndexed, E`,
      );
      expect(args.columns).toEqual([
        { name: "a", unindexed: false },
        { name: "b", unindexed: true },
        { name: "c", unindexed: true },
        { name: "d", unindexed: false },
        { name: "my col", unindexed: true },
        { name: "E", unindexed: false },
      ]);
      expect(args.unparsed).toEqual([]);
    });

    it("applies the defaults when no option is given", () => {
      expect(parseFts5Args("a, b")).toEqual({
        columns: [
          { name: "a", unindexed: false },
          { name: "b", unindexed: false },
        ],
        content: { mode: "own" },
        tokenize: ["unicode61"],
        prefix: [],
        detail: "full",
        columnsize: "1",
        options: new Map(),
        unparsed: [],
      });
    });

    it("reads options case-insensitively with any value quoting", () => {
      const args = parseFts5Args(
        `a, TOKENIZE = "porter", Prefix='3 2', prefix=[2], DETAIL=Column, columnsize='0', tokendata=1, contentless_delete = '1', locale=0`,
      );
      expect(args.tokenize).toEqual(["porter", "unicode61"]);
      expect(args.prefix).toEqual(["2", "3"]);
      expect(args.detail).toBe("column");
      expect(args.columnsize).toBe("0");
      expect(args.options).toEqual(
        new Map([
          ["tokendata", "1"],
          ["contentless_delete", "1"],
          ["locale", "0"],
        ]),
      );
    });

    it.each([
      ["content=docs", { mode: "external", table: "docs", rowid: null }],
      [`content="Docs", content_rowid='id'`, { mode: "external", table: "Docs", rowid: "id" }],
      ["content=[docs], content_rowid=ROWID", { mode: "external", table: "docs", rowid: null }],
      ["content=''", { mode: "contentless" }],
      [`content=""`, { mode: "contentless" }],
      ["content_rowid=id", { mode: "own" }],
    ])("reads the content mode of (%s)", (options, content) => {
      expect(parseFts5Args(`a, ${options}`).content).toEqual(content);
    });

    it("keeps content_rowid of a contentless table as a plain option", () => {
      expect(parseFts5Args("a, content='', content_rowid=id").options).toEqual(
        new Map([["content_rowid", "id"]]),
      );
    });

    it.each([
      ["tokenize=porter", ["porter", "unicode61"]],
      ["tokenize='PORTER  Unicode61'", ["porter", "unicode61"]],
      ["tokenize='porter unicode61 remove_diacritics 1'", ["porter", "unicode61"]],
      ["tokenize='unicode61 remove_diacritics 2'", ["unicode61", "remove_diacritics", "2"]],
      [
        "tokenize='unicode61 remove_diacritics 1 tokenchars ''-_'''",
        ["unicode61", "tokenchars", "'-_'"],
      ],
      ["tokenize='porter ascii'", ["porter", "ascii"]],
      ["tokenize=trigram", ["trigram"]],
      ["tokenize = 'trigram case_sensitive 1'", ["trigram", "case_sensitive", "1"]],
    ])("normalizes (%s)", (option, tokenize) => {
      expect(parseFts5Args(`a, ${option}`).tokenize).toEqual(tokenize);
    });

    it("keeps arguments it does not understand, normalized", () => {
      expect(parseFts5Args("a, b c d,   x   =   ").unparsed).toEqual(["b c d", "x ="]);
    });
  });

  describe("diff", () => {
    it.each([
      ["a, b", `"a", [b]`],
      ["a, b", "`a`,'b'"],
      ["a, b UNINDEXED", `a, b "unindexed"`],
      ["a, tokenize=porter", `a, TOKENIZE = "porter"`],
      ["a, tokenize=porter", "a, tokenize='porter unicode61'"],
      ["a, tokenize=porter", "a, tokenize=[PORTER]"],
      ["a, tokenize='porter unicode61'", "a, tokenize='  porter   unicode61  '"],
      ["a, tokenize='porter unicode61'", "a, tokenize='porter unicode61 remove_diacritics 1'"],
      ["a", "a, tokenize=unicode61"],
      ["a", "a, tokenize='unicode61 remove_diacritics 1'"],
      // FTS5 dequotes every tokenizer word
      [
        "a, tokenize='unicode61 remove_diacritics 2'",
        `a, tokenize="unicode61 'remove_diacritics' '2'"`,
      ],
      ["a, tokenize='porter ascii'", `a, tokenize="'porter' 'ascii'"`],
      ["a, tokenize='porter ascii'", `a, tokenize="'PORTER' ascii"`],
      ["a", `a, tokenize="'unicode61' 'remove_diacritics' '1'"`],
      ["a, tokenize='unicode61 tokenchars ''-_'''", `a, tokenize="'unicode61' 'tokenchars' '-_'"`],
      ["a, prefix='2 3'", "a, prefix=3, prefix=2"],
      ["a, prefix='2 3'", "a, PREFIX = ' 2  3 '"],
      ["a, prefix='2 3'", "a, prefix='2,3'"],
      ["a, prefix='2 3'", "a, prefix='3 2 2'"],
      ["a", "a, detail=full"],
      ["a, detail=column", "a, DETAIL='COLUMN'"],
      ["a", "a, columnsize=1"],
      ["a, columnsize=0", "a, columnsize='0'"],
      ["a, content=docs", "a, content='DOCS', content_rowid=rowid"],
      ["a, content=docs, content_rowid=id", `a, CONTENT="docs", content_rowid=ID`],
      ["a", "a, content_rowid=id"],
      ["a, content=''", `a, content=""`],
      ["a, contentless_delete=1, content=''", "a, content = '', CONTENTLESS_DELETE = '1'"],
      [
        "a, b, content=docs, tokenize='porter unicode61', prefix='2 3'",
        "prefix=3, TOKENIZE=porter, a, prefix=2, content=[docs], b",
      ],
    ])("treats (%s) and (%s) as equivalent", (a, b) => {
      expect(differences(a, b)).toEqual([]);
      expect(differences(b, a)).toEqual([]);
    });

    it.each([
      ["a, b", "a, b, c", "fts5.columns"],
      ["a, b", "b, a", "fts5.columns"],
      ["a, b", "a, B", "fts5.columns"],
      ["a, b", "a, b UNINDEXED", "fts5.columns"],
      ["a", "a, tokenize=porter", "fts5.tokenize"],
      ["a, tokenize='porter unicode61'", "a, tokenize='porter ascii'", "fts5.tokenize"],
      ["a", "a, tokenize='unicode61 remove_diacritics 0'", "fts5.tokenize"],
      ["a", "a, tokenize='unicode61 remove_diacritics 2'", "fts5.tokenize"],
      [
        "a, tokenize='unicode61 tokenchars ''-'''",
        "a, tokenize='unicode61 tokenchars ''_'''",
        "fts5.tokenize",
      ],
      ["a", "a, prefix=2", "fts5.prefix"],
      ["a, prefix='2 3'", "a, prefix='2 4'", "fts5.prefix"],
      ["a", "a, detail=none", "fts5.detail"],
      ["a", "a, columnsize=0", "fts5.columnsize"],
      ["a", "a, content=docs", "fts5.content"],
      ["a", "a, content=''", "fts5.content"],
      ["a, content=docs", "a, content=other", "fts5.content"],
      ["a, content=docs", "a, content=docs, content_rowid=id", "fts5.content"],
      ["a, content=''", "a, content=docs", "fts5.content"],
      ["a, content=''", "a, content='', contentless_delete=1", "fts5.option.contentless_delete"],
      ["a", "a, tokendata=0", "fts5.option.tokendata"],
      ["a, content=''", "a, content='', content_rowid=id", "fts5.option.content_rowid"],
    ])("reports (%s) → (%s) as %s", (a, b, check) => {
      expect(differences(a, b).map((r) => r.check)).toEqual([check]);
    });

    it("reports every difference", () => {
      expect(
        differences("a, b", "a, c, tokenize=porter, prefix=2, detail=column").map((r) => r.check),
      ).toEqual(["fts5.columns", "fts5.tokenize", "fts5.prefix", "fts5.detail"]);
    });

    it("describes the change", () => {
      expect(differences("a, b UNINDEXED", "a, c")).toEqual([
        { check: "fts5.columns", detail: "Columns changed: (a, b UNINDEXED) → (a, c)" },
      ]);
    });
  });

  describe("rename, dependencies and dependency reactions", () => {
    it("supports rename except for contentless_unindexed tables", () => {
      expect(fts5Module.supportsRename).toBe(true);
      const own = fts("f", "a");
      const cu = fts("f", "a, b UNINDEXED, content='', contentless_unindexed=1");
      expect(fts5Module.canRename?.(own, parseFts5Args(own.args))).toBe(true);
      expect(fts5Module.canRename?.(cu, parseFts5Args(cu.args))).toBe(false);
    });

    it("depends on the content table of an external-content table only", () => {
      const ext = fts("f", "a, content='Docs'");
      expect(fts5Module.dependencies(ext, parseFts5Args(ext.args))).toEqual(["Docs"]);
      for (const args of ["a", "a, content=''"]) {
        expect(fts5Module.dependencies(fts("f", args), parseFts5Args(args))).toEqual([]);
      }
    });

    it("rebuilds after its content table is recreated and recreates after it is renamed", () => {
      const target = fts("f", "a, content=docs");
      const args = parseFts5Args(target.args);
      const react = (change: "recreated" | "renamed") =>
        fts5Module.onDependencyChanged?.({ target, args, dependency: "docs", change });
      expect(react("recreated")).toBe("rebuild");
      expect(react("renamed")).toBe("recreate");

      const own = fts("f", "a");
      expect(
        fts5Module.onDependencyChanged?.({
          target: own,
          args: parseFts5Args(own.args),
          dependency: "docs",
          change: "recreated",
        }),
      ).toBe("none");
    });

    it("rebuilds an external-content table from its content table", () => {
      const target = fts("f", "a, content='docs'");
      expect(fts5Module.rebuild?.({ target, args: parseFts5Args(target.args) })).toEqual([
        `INSERT INTO "f"("f") SELECT 'rebuild' WHERE (SELECT count(DISTINCT lower(name)) FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) IN ('a')) = 1 AND (EXISTS (SELECT 1 FROM pragma_table_list('docs') WHERE schema = 'main' AND type IN ('table', 'shadow') AND wr = 0) OR EXISTS (SELECT 1 FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) = 'rowid'));`,
      ]);
    });

    it("guards the rebuild on the content_rowid column instead of the rowid when it is set", () => {
      const target = fts("f", "a, content='docs', content_rowid=id");
      expect(fts5Module.rebuild?.({ target, args: parseFts5Args(target.args) })).toEqual([
        `INSERT INTO "f"("f") SELECT 'rebuild' WHERE (SELECT count(DISTINCT lower(name)) FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) IN ('a', 'id')) = 2;`,
      ]);
    });
  });

  describe("create and drop", () => {
    it("creates with the exact SQL, rebuilding an external-content index", () => {
      const own = fts("f", "a, b");
      expect(fts5Module.create?.(own, parseFts5Args(own.args))).toEqual([
        "CREATE VIRTUAL TABLE f USING fts5(a, b);",
      ]);
      const ext = fts("f", 'a, content="it\'s"');
      expect(fts5Module.create?.(ext, parseFts5Args(ext.args))).toEqual([
        `CREATE VIRTUAL TABLE f USING fts5(a, content="it's");`,
        `INSERT INTO "f"("f") SELECT 'rebuild' WHERE (SELECT count(DISTINCT lower(name)) FROM pragma_table_xinfo('it''s', 'main') WHERE hidden <> 1 AND lower(name) IN ('a')) = 1 AND (EXISTS (SELECT 1 FROM pragma_table_list('it''s') WHERE schema = 'main' AND type IN ('table', 'shadow') AND wr = 0) OR EXISTS (SELECT 1 FROM pragma_table_xinfo('it''s', 'main') WHERE hidden <> 1 AND lower(name) = 'rowid'));`,
      ]);
    });

    it("drops with DROP TABLE", () => {
      const own = fts("f", "a");
      expect(fts5Module.drop?.(own, parseFts5Args(own.args))).toEqual([
        'DROP TABLE IF EXISTS "f";',
      ]);
    });

    it("parks a contentless_unindexed table before dropping it and its left-over content table", () => {
      const cu = fts("f", "a, b UNINDEXED, content='', contentless_unindexed=1");
      expect(fts5Module.drop?.(cu, parseFts5Args(cu.args))).toEqual([
        "PRAGMA legacy_alter_table = ON;",
        'ALTER TABLE "f" RENAME TO "sqlrite_fts5_drop_f";',
        "PRAGMA legacy_alter_table = OFF;",
        'DROP TABLE "sqlrite_fts5_drop_f";',
        'DROP TABLE IF EXISTS "main"."f_content";',
      ]);
    });
  });

  describe("recreate", () => {
    const saveConfig = (name: string, target = name) =>
      `CREATE TEMP TABLE temp."sqlrite_fts5_config_${target}" AS SELECT k, v FROM "${name}_config" WHERE k <> 'version';`;
    // bm25() weights of the rank setting follow their columns (target position,
    // current position)
    const remapRank = (name: string, map: string) =>
      expect.stringMatching(
        new RegExp(
          `^UPDATE temp\\."sqlrite_fts5_config_${name}" SET v = \\(WITH RECURSIVE .* AS \\(VALUES ${map.replace(/[()]/g, "\\$&")}\\) .* WHERE k = 'rank' AND lower\\(.*\\) = 'bm25' .*;$`,
        ),
      );
    const restoreConfig = (name: string) => [
      `INSERT INTO "${name}"("${name}", rank) SELECT k, v FROM temp."sqlrite_fts5_config_${name}";`,
      `DROP TABLE temp."sqlrite_fts5_config_${name}";`,
    ];

    it("copies the shared columns of an own-content table with their rowids", () => {
      const current = fts("f", "a, b, c");
      const target = fts("f", "C, a, d, tokenize=porter");
      expect(recreate(current, target)).toEqual([
        saveConfig("f"),
        remapRank("f", "(0, 2), (1, 0), (2, NULL)"),
        `CREATE TEMP TABLE temp."sqlrite_fts5_rows_f" AS SELECT rowid AS "rowid", "c", "a" FROM "f";`,
        'DROP TABLE IF EXISTS "f";',
        "CREATE VIRTUAL TABLE f USING fts5(C, a, d, tokenize=porter);",
        ...restoreConfig("f"),
        `INSERT INTO "f"(rowid, "C", "a") SELECT "rowid", "c", "a" FROM temp."sqlrite_fts5_rows_f";`,
        `DROP TABLE temp."sqlrite_fts5_rows_f";`,
      ]);
    });

    it("recreates under the target name when the names differ", () => {
      const current = fts("old", "a");
      const target = fts("new", "a, b");
      expect(recreate(current, target)).toEqual([
        saveConfig("old", "new"),
        `CREATE TEMP TABLE temp."sqlrite_fts5_rows_new" AS SELECT rowid AS "rowid", "a" FROM "old";`,
        'DROP TABLE IF EXISTS "old";',
        "CREATE VIRTUAL TABLE new USING fts5(a, b);",
        ...restoreConfig("new"),
        `INSERT INTO "new"(rowid, "a") SELECT "rowid", "a" FROM temp."sqlrite_fts5_rows_new";`,
        `DROP TABLE temp."sqlrite_fts5_rows_new";`,
      ]);
    });

    it("copies an own-content table into a contentless one", () => {
      const statements = recreate(fts("f", "a"), fts("f", "a, content=''"));
      expect(statements).toContain(
        `INSERT INTO "f"(rowid, "a") SELECT "rowid", "a" FROM temp."sqlrite_fts5_rows_f";`,
      );
    });

    it("drops and creates without a copy when no column is kept", () => {
      expect(recreate(fts("f", "a"), fts("f", "b"))).toEqual([
        saveConfig("f"),
        remapRank("f", "(0, NULL)"),
        'DROP TABLE IF EXISTS "f";',
        "CREATE VIRTUAL TABLE f USING fts5(b);",
        ...restoreConfig("f"),
      ]);
    });

    it("rebuilds an external-content table from its content table", () => {
      const current = fts("f", "a, content=docs");
      const target = fts("f", "a, content=docs, tokenize=porter");
      expect(recreate(current, target)).toEqual([
        saveConfig("f"),
        'DROP TABLE IF EXISTS "f";',
        "CREATE VIRTUAL TABLE f USING fts5(a, content=docs, tokenize=porter);",
        ...restoreConfig("f"),
        `INSERT INTO "f"("f") SELECT 'rebuild' WHERE (SELECT count(DISTINCT lower(name)) FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) IN ('a')) = 1 AND (EXISTS (SELECT 1 FROM pragma_table_list('docs') WHERE schema = 'main' AND type IN ('table', 'shadow') AND wr = 0) OR EXISTS (SELECT 1 FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) = 'rowid'));`,
      ]);
    });

    it("reads the rows of a formerly external-content table from its content table", () => {
      const current = fts("f", "a, b, content=Docs, content_rowid=id");
      const target = fts("f", "a, b");
      expect(recreate(current, target, schemaWith("docs", ["id", "a"]))).toEqual([
        saveConfig("f"),
        'DROP TABLE IF EXISTS "f";',
        "CREATE VIRTUAL TABLE f USING fts5(a, b);",
        ...restoreConfig("f"),
        `INSERT INTO "f"(rowid, "a") SELECT "id", "a" FROM "docs";`,
      ]);
    });

    it.each([
      ["the content table is not in the desired schema", none],
      ["the content table lacks content_rowid", schemaWith("docs", ["a"])],
      ["the content table has none of the kept columns", schemaWith("docs", ["id", "z"])],
    ])("does not copy from a content table when %s", (_case, desired) => {
      const statements = recreate(
        fts("f", "a, content=docs, content_rowid=id"),
        fts("f", "a"),
        desired,
      );
      expect(statements.some((s) => s.startsWith('INSERT INTO "f"(rowid'))).toBe(false);
    });

    it("does not copy from a contentless table", () => {
      const statements = recreate(fts("f", "a, content=''"), fts("f", "a, b, content=''"));
      expect(statements.some((s) => s.includes("rows"))).toBe(false);
    });

    it("parks a contentless_unindexed table instead of dropping it directly", () => {
      const statements = recreate(
        fts("f", "a, b UNINDEXED, content='', contentless_unindexed=1"),
        fts("f", "a, b UNINDEXED, c, content='', contentless_unindexed=1"),
      );
      expect(statements).toContain('ALTER TABLE "f" RENAME TO "sqlrite_fts5_drop_f";');
      expect(statements).toContain('DROP TABLE IF EXISTS "main"."f_content";');
      expect(statements).not.toContain('DROP TABLE IF EXISTS "f";');
    });
  });

  describe("warnings", () => {
    it("warns about data loss when dropping a table that holds its own data", () => {
      for (const args of ["a", "a, content=''"]) {
        const warnings = fts5Module.warnings({
          op: { type: "drop", current: fts("f", args) },
          desired: none,
        });
        expect(warnings).toEqual([
          {
            type: "destructive",
            message: expect.stringContaining('Data in virtual table "f" will be lost'),
          },
        ]);
      }
    });

    it("only cautions when dropping an external-content table", () => {
      const warnings = fts5Module.warnings({
        op: { type: "drop", current: fts("f", "a, content=docs") },
        desired: none,
      });
      expect(warnings.map((w) => w.type)).toEqual(["caution"]);
      expect(warnings[0]?.message).toContain('content table "docs" is not modified');
    });

    it("does not warn on create or rename", () => {
      const target = fts("f", "a");
      expect(fts5Module.warnings({ op: { type: "create", target }, desired: none })).toEqual([]);
      expect(
        fts5Module.warnings({
          op: { type: "rename", current: fts("e", "a"), target },
          desired: none,
        }),
      ).toEqual([]);
    });

    it("warns when an external-content table is created over a missing table", () => {
      const target = fts("f", "a, content=docs");
      expect(fts5Module.warnings({ op: { type: "create", target }, desired: none })[0]?.type).toBe(
        "destructive",
      );
      expect(
        fts5Module.warnings({ op: { type: "create", target }, desired: schemaWith("docs", ["a"]) }),
      ).toEqual([]);
    });

    it("cautions on a rebuild", () => {
      const warnings = fts5Module.warnings({
        op: { type: "rebuild", target: fts("f", "a, content=docs"), reasons: [] },
        desired: schemaWith("docs", ["a"]),
      });
      expect(warnings).toEqual([
        {
          type: "caution",
          message: expect.stringContaining('rebuilt from its content table "docs"'),
        },
      ]);
    });

    it.each([
      ["own content, columns kept", "a, b", "a, b, c", none, ["caution"], "rows are copied"],
      ["own content, a column dropped", "a, b", "a", none, ["destructive"], 'Column(s) "b"'],
      [
        "own content to contentless",
        "a",
        "a, content=''",
        none,
        ["destructive"],
        "no longer stored",
      ],
      [
        "contentless",
        "a, content=''",
        "a, b, content=''",
        none,
        ["destructive"],
        'Data in virtual table "f" will be lost',
      ],
      ["no column kept", "a", "b", none, ["destructive"], 'Data in virtual table "f" will be lost'],
      [
        "external content",
        "a, content=docs",
        "a, content=docs, tokenize=porter",
        schemaWith("docs", ["a"]),
        ["caution"],
        'rebuilt from its content table "docs"',
      ],
      [
        "external content over a missing table",
        "a, content=docs",
        "a, content=docs, tokenize=porter",
        none,
        ["destructive"],
        'content table "docs" does not exist',
      ],
      [
        "own content to external content",
        "a",
        "a, content=docs",
        schemaWith("docs", ["a"]),
        ["destructive"],
        "not copied",
      ],
      [
        "external content to own content",
        "a, content=docs",
        "a",
        schemaWith("docs", ["a"]),
        ["caution"],
        'read from "docs"',
      ],
    ])("on recreate: %s", (_case, from, to, desired, types, text) => {
      const warnings = recreateWarnings(fts("f", from), fts("f", to), desired);
      expect(warnings.map((w) => w.type)).toEqual(types);
      expect(warnings[0]?.message).toContain(text);
    });
  });
});
