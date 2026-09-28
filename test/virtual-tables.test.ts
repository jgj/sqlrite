import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3, { type Database } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Driver, getDriver } from "../src/driver";
import { introspect } from "../src/introspect";
import { migrate } from "../src/migrate";
import { type MigrationOptions, getMigrationPreview } from "../src/migration-statements";
import type { SQLite } from "../src/sqlite";
import { getBetterSqlite3Database, getLibsqlClient, getNodeSqliteDatabase } from "../src/sqlite";
import { registerFactoryModule } from "../src/test-utils";

// R*Tree is compiled into all three drivers and has no dedicated handler, so it
// exercises the general virtual table layer and the default handler: argument
// text comparison, DROP + CREATE recreates and destructive warnings.

const manage: MigrationOptions = { manageVirtualTables: true };

// Characters JavaScript's \s matches, but SQLite reads as part of a name
const nbsp = String.fromCharCode(0xa0);
const ideographic = String.fromCharCode(0x3000);

describe.each([
  ["libsql", getLibsqlClient],
  ["better-sqlite3", getBetterSqlite3Database],
  ["node:sqlite", getNodeSqliteDatabase],
])("virtual tables using %s", (clientName, getClient) => {
  let client: SQLite;
  let driver: Driver;

  beforeEach(async () => {
    client = await getClient();
    driver = getDriver(client);
  });

  afterEach(async () => {
    if ("close" in client) {
      await client.close();
    }
  });

  // Every object in the main schema except sqlite_* internals, with its
  // pragma_table_list classification
  async function catalog() {
    const rows = await driver.query<{ name: string; type: string }>(
      "SELECT name, type FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return rows.map((r) => `${r.name}:${r.type}`);
  }

  async function columnsOf(table: string) {
    const rows = await driver.query<{ name: string }>(
      `SELECT name FROM pragma_table_info('${table}') ORDER BY cid`,
    );
    return rows.map((r) => r.name);
  }

  async function expectIdempotent(ddl: string, options: MigrationOptions = manage) {
    const again = await getMigrationPreview(client, ddl, options);
    expect(again.statements).toEqual([]);
    expect(again.warnings).toEqual([]);
  }

  const places = "CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT NOT NULL);";
  const rtree2d = "CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX, minY, maxY);";

  describe("with manageVirtualTables on", () => {
    it("creates a virtual table", async () => {
      await driver.execute(places);
      const next = `${places}\n${rtree2d}`;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan).toEqual([
        { type: "create", target: expect.objectContaining({ name: "places_idx" }) },
      ]);
      expect(preview.statements).toEqual([rtree2d]);
      expect(preview.warnings).toEqual([]);

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);

      expect(await catalog()).toEqual([
        "places:table",
        "places_idx:virtual",
        "places_idx_node:shadow",
        "places_idx_parent:shadow",
        "places_idx_rowid:shadow",
      ]);
      await driver.execute("INSERT INTO places_idx VALUES (1, 0, 10, 0, 10)");
      const hits = await driver.query<{ id: number }>(
        "SELECT id FROM places_idx WHERE minX <= 5 AND maxX >= 5",
      );
      expect(hits.map((h) => Number(h.id))).toEqual([1]);

      await expectIdempotent(next);
    });

    it("drops a virtual table with a destructive warning", async () => {
      await driver.execute(`${places}\n${rtree2d}\nINSERT INTO places_idx VALUES (1, 0, 1, 0, 1);`);

      const preview = await getMigrationPreview(client, places, manage);
      expect(preview.statements).toEqual(['DROP TABLE IF EXISTS "places_idx";']);
      expect(preview.warnings).toHaveLength(1);
      expect(preview.warnings[0]?.type).toBe("destructive");
      expect(preview.warnings[0]?.message).toContain(
        'Data in virtual table "places_idx" will be lost',
      );

      const res = await migrate(client, places, manage);
      expect(res.success, res.err?.message).toBe(true);
      // The shadow tables go with it
      expect(await catalog()).toEqual(["places:table"]);

      await expectIdempotent(places);
    });

    it("recreates a changed virtual table with DROP + CREATE and a destructive warning", async () => {
      await driver.execute(`
        ${places}
        CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX);
        INSERT INTO places_idx VALUES (1, 0, 1);
      `);
      const next = `${places}\n${rtree2d}`;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan).toHaveLength(1);
      expect(preview.plan[0]).toMatchObject({
        type: "recreate",
        current: { type: "virtual_table", name: "places_idx", module: "rtree" },
        target: { type: "virtual_table", name: "places_idx", module: "rtree" },
        reasons: [{ check: "virtual_table.args" }],
      });
      expect(preview.statements).toEqual(['DROP TABLE IF EXISTS "places_idx";', rtree2d]);
      expect(preview.warnings).toHaveLength(1);
      expect(preview.warnings[0]?.type).toBe("destructive");
      expect(preview.warnings[0]?.message).toContain(
        'Data in virtual table "places_idx" will be lost',
      );

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);
      expect(await columnsOf("places_idx")).toEqual(["id", "minX", "maxX", "minY", "maxY"]);
      const count = await driver.query<{ n: number }>("SELECT count(*) AS n FROM places_idx");
      expect(Number(count[0]?.n)).toBe(0);

      await expectIdempotent(next);
    });

    it("recreates when the module changes", async () => {
      await driver.execute("CREATE VIRTUAL TABLE docs USING fts4(title, body);");
      const next = "CREATE VIRTUAL TABLE docs USING fts3(title, body);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan).toMatchObject([
        { type: "recreate", reasons: [{ check: "virtual_table.module" }] },
      ]);
      expect(preview.statements).toEqual(['DROP TABLE IF EXISTS "docs";', next]);

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);
      await expectIdempotent(next);
    });

    it("carries out a name change as DROP + CREATE (the default handler cannot rename)", async () => {
      await driver.execute("CREATE VIRTUAL TABLE old_idx USING rtree(id, minX, maxX);");
      const next = "CREATE VIRTUAL TABLE new_idx USING rtree(id, minX, maxX);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.statements).toEqual(['DROP TABLE IF EXISTS "old_idx";', next]);
      expect(preview.warnings.map((w) => w.type)).toEqual(["destructive"]);

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);
      await expectIdempotent(next);
    });

    it("emits nothing for cosmetically different but equivalent definitions", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE a USING rtree(id, minX, maxX);
        CREATE VIRTUAL TABLE tmp USING rtree(id, minX, maxX);
        ALTER TABLE tmp RENAME TO b;
      `);

      // b is stored as CREATE VIRTUAL TABLE "b" ... after the rename
      await expectIdempotent(`
        create virtual table if not exists "a" using RTREE ( id ,  "minX",
          [maxX] );
        CREATE VIRTUAL TABLE b USING rtree(id,minX,maxX);
      `);
    });

    it("ignores a difference in the name's case alone, keeping the data", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE Geo USING rtree(id, x0, x1);
        INSERT INTO Geo VALUES (1, 0, 1);
      `);
      const next = "CREATE VIRTUAL TABLE geo USING rtree(id, x0, x1);";

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);
      expect(res.statements).toEqual([]);
      expect(res.warnings).toEqual([]);
      const count = await driver.query<{ n: number }>("SELECT count(*) AS n FROM geo");
      expect(Number(count[0]?.n)).toBe(1);
      await expectIdempotent(next);
    });

    it("keeps a view over a virtual table working across its recreate", async () => {
      await driver.execute(`
        ${places}
        CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX);
        CREATE VIEW places_idx_view AS SELECT id, minX FROM places_idx;
        INSERT INTO places VALUES (1, 'home');
      `);
      // places is recreated too (its CHECK changes); its ALTER TABLE ... RENAME
      // would fail if the view were left pointing at a dropped table
      const next = `
        CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) > 0));
        ${rtree2d}
        CREATE VIEW places_idx_view AS SELECT id, minX FROM places_idx;
      `;

      const preview = await getMigrationPreview(client, next, manage);
      const statements = preview.statements;
      const dropView = statements.indexOf('DROP VIEW IF EXISTS "places_idx_view";');
      const dropVt = statements.indexOf('DROP TABLE IF EXISTS "places_idx";');
      const createVt = statements.indexOf(rtree2d);
      const createView = statements.findIndex((s) => s.startsWith("CREATE VIEW places_idx_view"));
      const renamePlaces = statements.indexOf('ALTER TABLE "temp_places" RENAME TO "places";');
      expect(renamePlaces).toBeGreaterThan(-1);
      expect(renamePlaces).toBeLessThan(dropVt);
      expect(dropView).toBeGreaterThan(-1);
      expect(dropView).toBeLessThan(dropVt);
      expect(dropVt).toBeLessThan(createVt);
      expect(createVt).toBeLessThan(createView);
      expect(statements.filter((s) => s.startsWith("CREATE VIEW"))).toHaveLength(1);

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);

      await driver.execute("INSERT INTO places_idx VALUES (7, 1, 2, 3, 4)");
      const rows = await driver.query<{ id: number; minX: number }>(
        "SELECT id, minX FROM places_idx_view",
      );
      expect(rows.map((r) => [Number(r.id), Number(r.minX)])).toEqual([[7, 1]]);
      const kept = await driver.query<{ name: string }>("SELECT name FROM places");
      expect(kept).toEqual([{ name: "home" }]);

      await expectIdempotent(next);
    });

    it("creates a modified view over a recreated virtual table once, with the desired SQL", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX);
        CREATE VIEW places_idx_view AS SELECT id FROM places_idx;
      `);
      const next = `
        ${rtree2d}
        CREATE VIEW places_idx_view AS SELECT id, minY FROM places_idx;
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.statements.filter((s) => s.includes("places_idx_view"))).toEqual([
        'DROP VIEW IF EXISTS "places_idx_view";',
        "CREATE VIEW places_idx_view AS SELECT id, minY FROM places_idx;",
      ]);

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);
      expect(await columnsOf("places_idx_view")).toEqual(["id", "minY"]);
      await expectIdempotent(next);
    });

    // The virtual tables a view reads are listed in sqlite_schema order, which
    // a recreate or a different declaration order changes
    describe("a view over two virtual tables", () => {
      const view =
        "CREATE VIEW v AS SELECT a.x AS ax, b.x AS bx FROM a JOIN b ON a.rowid = b.rowid;";

      it("is left alone after one of them is recreated", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE a USING fts5(x);
          CREATE VIRTUAL TABLE b USING rtree(id, x1, x2);
          ${view}
        `);
        const next = `
          CREATE VIRTUAL TABLE a USING fts5(x, tokenize=porter);
          CREATE VIRTUAL TABLE b USING rtree(id, x1, x2);
          ${view}
        `;

        const res = await migrate(client, next, manage);
        expect(res.success, res.err?.message).toBe(true);
        await expectIdempotent(next);
      });

      it("is left alone when they are declared in another order", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE a USING fts5(x);
          CREATE VIRTUAL TABLE b USING fts5(x);
          ${view}
        `);
        const next = `
          CREATE VIRTUAL TABLE b USING fts5(x);
          CREATE VIRTUAL TABLE a USING fts5(x);
          ${view}
        `;
        await expectIdempotent(next);
      });

      it("is left alone when a virtual table's name differs only in case", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE Docs USING fts5(title);
          CREATE VIEW dv AS SELECT * FROM Docs;
        `);
        const next = `
          CREATE VIRTUAL TABLE docs USING fts5(title);
          CREATE VIEW dv AS SELECT * FROM docs;
        `;

        // The view's SQL changes; the virtual table keeps its name, Docs
        const res = await migrate(client, next, manage);
        expect(res.success, res.err?.message).toBe(true);
        await expectIdempotent(next);
      });
    });

    it("leaves unchanged virtual tables and their data alone", async () => {
      await driver.execute(`${rtree2d}\nINSERT INTO places_idx VALUES (1, 0, 1, 0, 1);`);
      const next = `${rtree2d}\n${places}`;

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);
      expect(res.statements).toEqual([`${places}`]);
      const count = await driver.query<{ n: number }>("SELECT count(*) AS n FROM places_idx");
      expect(Number(count[0]?.n)).toBe(1);
    });

    describe("with ignoreTableDeletion", () => {
      const options: MigrationOptions = { ...manage, ignoreTableDeletion: true };

      it("keeps a virtual table missing from the desired schema, and the views over it", async () => {
        await driver.execute(`
          ${rtree2d}
          CREATE VIEW places_idx_view AS SELECT id FROM places_idx;
          INSERT INTO places_idx VALUES (1, 0, 1, 0, 1);
        `);

        const preview = await getMigrationPreview(client, "", options);
        expect(preview.statements).toEqual([]);
        expect(preview.warnings).toEqual([]);

        const res = await migrate(client, "", options);
        expect(res.success, res.err?.message).toBe(true);
        const rows = await driver.query<{ id: number }>("SELECT id FROM places_idx_view");
        expect(rows.map((r) => Number(r.id))).toEqual([1]);
      });

      it("still recreates a virtual table present in the desired schema", async () => {
        await driver.execute("CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX);");

        const preview = await getMigrationPreview(client, rtree2d, options);
        expect(preview.statements).toEqual(['DROP TABLE IF EXISTS "places_idx";', rtree2d]);
      });

      // The view is not declared, but it reads a table that is kept, so it is
      // kept too; the recreate of the other virtual table it reads drops it
      it.each([
        ["virtual table", "CREATE VIRTUAL TABLE old USING fts5(x);"],
        ["table", "CREATE TABLE old (rowid INTEGER PRIMARY KEY, x TEXT);"],
      ])("puts back an undeclared view over a kept %s", async (_kind, old) => {
        const view =
          "CREATE VIEW v AS SELECT places_idx.id, old.x FROM places_idx JOIN old ON old.rowid = places_idx.id";
        await driver.execute(`
          CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX);
          ${old}
          ${view};
          INSERT INTO old (rowid, x) VALUES (1, 'kept');
        `);

        const res = await migrate(client, rtree2d, options);
        expect(res.success, res.err?.message).toBe(true);
        const views = await driver.query<{ sql: string }>(
          "SELECT sql FROM sqlite_schema WHERE type = 'view'",
        );
        expect(views).toEqual([{ sql: view }]);
        await driver.execute("INSERT INTO places_idx VALUES (1, 0, 1, 0, 1)");
        const rows = await driver.query<{ x: string }>("SELECT x FROM v");
        expect(rows).toEqual([{ x: "kept" }]);
        await expectIdempotent(rtree2d, options);
      });

      // The name is declared as the other kind of object: it is replaced, not
      // deleted, so the old object is dropped to free the name
      const table = "CREATE TABLE places_idx (id INTEGER PRIMARY KEY, title TEXT);";
      it.each([
        ["a virtual table is replaced by a table", rtree2d, table],
        ["a table is replaced by a virtual table", table, rtree2d],
        [
          "an FTS5 table is replaced by a table",
          "CREATE VIRTUAL TABLE places_idx USING fts5(title);",
          table,
        ],
        [
          "a table is replaced by an FTS5 table",
          table,
          "CREATE VIRTUAL TABLE places_idx USING fts5(title);",
        ],
        [
          "a virtual table is replaced by a table named in another case",
          "CREATE VIRTUAL TABLE Places_Idx USING fts5(title);",
          table,
        ],
        [
          "a table is replaced by a virtual table named in another case",
          "CREATE TABLE Places_Idx (id INTEGER PRIMARY KEY, title TEXT);",
          rtree2d,
        ],
      ])("drops the old object when %s", async (_case, current, next) => {
        await driver.execute(current);

        const preview = await getMigrationPreview(client, next, options);
        expect(preview.statements[0]).toMatch(/^DROP TABLE IF EXISTS "places_idx";$/i);
        expect(preview.warnings.map((w) => w.type)).toContain("destructive");

        const res = await migrate(client, next, options);
        expect(res.success, res.err?.message).toBe(true);
        await expectIdempotent(next, options);
      });
    });
  });

  describe("with manageVirtualTables off (the default)", () => {
    it("does not create a virtual table", async () => {
      const preview = await getMigrationPreview(client, `${places}\n${rtree2d}`);

      expect(preview.statements).toEqual([places]);
      expect(preview.warnings).toEqual([]);
      expect(preview.plan.every((op) => (op.target ?? op.current)?.type === "table")).toBe(true);
    });

    it("does not drop a virtual table or touch its shadow tables", async () => {
      await driver.execute(`${rtree2d}\nINSERT INTO places_idx VALUES (1, 0, 1, 0, 1);`);

      const res = await migrate(client, "");
      expect(res.success, res.err?.message).toBe(true);
      expect(res.statements).toEqual([]);
      expect(res.warnings).toEqual([]);

      const count = await driver.query<{ n: number }>("SELECT count(*) AS n FROM places_idx");
      expect(Number(count[0]?.n)).toBe(1);
    });

    it("does not recreate a changed virtual table", async () => {
      await driver.execute("CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX);");

      const preview = await getMigrationPreview(client, rtree2d);
      expect(preview.statements).toEqual([]);
      expect(preview.warnings).toEqual([]);
    });

    it("leaves a view over a virtual table the desired schema omits alone", async () => {
      await driver.execute(`
        ${rtree2d}
        CREATE VIEW places_idx_view AS SELECT id FROM places_idx;
      `);
      const next = "CREATE VIEW places_idx_view AS SELECT id FROM places_idx;";

      // The view resolves to places_idx only in the live database
      const preview = await getMigrationPreview(client, next);
      expect(preview.diff.view.modified.map((m) => m.changes)).toEqual([["tables"]]);
      expect(preview.statements).toEqual([]);

      const res = await migrate(client, next);
      expect(res.success, res.err?.message).toBe(true);
      expect(res.statements).toEqual([]);
      await expectIdempotent(next, {});
    });

    // SQLite stores everything from the virtual table's name onward verbatim
    it.each([
      [
        "a comment after the name",
        "CREATE VIRTUAL TABLE docs-- full-text index\nUSING fts5(body);",
      ],
      ["a comment after the module", "CREATE VIRTUAL TABLE docs USING fts5/* search */(body);"],
      ["a no-break space inside the name", `CREATE VIRTUAL TABLE t${nbsp}x USING fts5(body);`],
      [
        "an ideographic space inside the name",
        `CREATE VIRTUAL TABLE t${ideographic}x USING fts5(body);`,
      ],
    ])("migrates the other tables of a database with %s", async (_what, vt) => {
      await driver.execute(`${vt}\nCREATE TABLE docs_meta (id INTEGER PRIMARY KEY, v TEXT);`);
      const next = `${vt}\nCREATE TABLE docs_meta (id INTEGER PRIMARY KEY, v TEXT, w TEXT);`;

      const res = await migrate(client, next);
      expect(res.success, res.err?.message).toBe(true);
      expect(res.statements).toEqual(['ALTER TABLE "docs_meta" ADD COLUMN "w" TEXT;']);
      await expectIdempotent(next, {});
      await expectIdempotent(next);
    });

    it("still reports the difference in the diff", async () => {
      await driver.execute("CREATE VIRTUAL TABLE places_idx USING rtree(id, minX, maxX);");

      const preview = await getMigrationPreview(client, rtree2d);
      expect(preview.diff.virtual_table.modified).toHaveLength(1);
    });
  });

  describe("shadow tables", () => {
    const moduleZoo = `
      CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT);
      CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX);
      CREATE VIRTUAL TABLE f5 USING fts5(title, body);
      CREATE VIRTUAL TABLE f4 USING fts4(a);
      CREATE VIRTUAL TABLE ext USING fts5(body, content='t', content_rowid='id');
    `;

    it("never appear as tables, including after a rename", async () => {
      await driver.execute(`
        ${moduleZoo}
        ALTER TABLE rt RENAME TO rt_renamed;
        ALTER TABLE f5 RENAME TO f5_renamed;
      `);

      const ir = await introspect(driver);
      expect(ir.tables.map((t) => t.name)).toEqual(["t"]);
      expect(ir.virtual_tables.map((vt) => vt.name)).toEqual([
        "rt_renamed",
        "f5_renamed",
        "f4",
        "ext",
      ]);
    });

    it.each([
      ["on", manage],
      ["off", {}],
    ])("are never created as tables with manageVirtualTables %s", async (_flag, options) => {
      const preview = await getMigrationPreview(client, moduleZoo, options);

      expect(preview.statements.filter((s) => /^CREATE TABLE/i.test(s))).toEqual([
        "CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT);",
      ]);

      const res = await migrate(client, moduleZoo, options);
      expect(res.success, res.err?.message).toBe(true);
      await expectIdempotent(moduleZoo, options);
    });

    // SQLite classifies a table as a shadow table by its name alone: a user
    // table posts_content next to an FTS5 table posts is 'shadow' in
    // pragma_table_list, although an external-content FTS5 table has no
    // %_content table of its own
    describe("named like one the virtual table does not create", () => {
      const postsContent = "CREATE TABLE posts_content (id INTEGER PRIMARY KEY, body TEXT);";
      const posts =
        "CREATE VIRTUAL TABLE posts USING fts5(body, content=posts_content, content_rowid=id);";
      const seed = "INSERT INTO posts_content (id, body) VALUES (1, 'hello'), (2, 'world');";

      async function count(table: string) {
        const rows = await driver.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
        return Number(rows[0]?.n);
      }

      it.each([
        ["off", {}],
        ["on", manage],
      ])(
        "is kept when an FTS5 table reading from it is added (flag %s)",
        async (_flag, options) => {
          await driver.execute(`${postsContent}\n${seed}`);
          const next = `${postsContent}\n${posts}`;

          const preview = await getMigrationPreview(client, next, options);
          expect(
            preview.statements.filter((s) => /posts_content/i.test(s) && /DROP/i.test(s)),
          ).toEqual([]);
          expect(preview.warnings).toEqual([]);

          const res = await migrate(client, next, options);
          expect(res.success, res.err?.message).toBe(true);
          expect(await count("posts_content")).toBe(2);
          await expectIdempotent(next, options);
        },
      );

      it("gets its column and index changes", async () => {
        await driver.execute(`${postsContent}\n${posts}`);
        const next = `
          CREATE TABLE posts_content (id INTEGER PRIMARY KEY, body TEXT, author TEXT);
          CREATE INDEX posts_content_author ON posts_content (author);
          ${posts}
        `;

        // better-sqlite3 (defensive mode) and SQLite 3.50 refuse to alter a
        // table with a reserved name, so only the statements are checked
        const preview = await getMigrationPreview(client, next);
        expect(preview.statements).toEqual([
          'ALTER TABLE "posts_content" ADD COLUMN "author" TEXT;',
          "CREATE INDEX posts_content_author ON posts_content (author);",
        ]);
      });

      // Only libsql (SQLite 3.45) lets such a table be created at all
      it.runIf(clientName === "libsql")("is created next to a contentless table", async () => {
        const docs = "CREATE VIRTUAL TABLE docs USING fts5(body, content='');";
        await driver.execute(docs);
        const next = `${docs}\nCREATE TABLE docs_content (id INTEGER PRIMARY KEY, note TEXT);`;

        const res = await migrate(client, next);
        expect(res.success, res.err?.message).toBe(true);
        expect(res.statements).toEqual([
          "CREATE TABLE docs_content (id INTEGER PRIMARY KEY, note TEXT);",
        ]);
        await expectIdempotent(next, {});
      });

      it("is dropped when the desired schema no longer declares it", async () => {
        await driver.execute(`${postsContent}\n${posts}`);
        const preview = await getMigrationPreview(client, posts);
        expect(preview.statements).toEqual(['DROP TABLE IF EXISTS "posts_content";']);
      });

      // FTS5 has no %_docsize table with columnsize=0
      it("is visible next to an FTS5 table with columnsize=0", async () => {
        const docsize = "CREATE TABLE docs_docsize (id INTEGER PRIMARY KEY, x TEXT);";
        const docs = "CREATE VIRTUAL TABLE docs USING fts5(body, columnsize=0);";
        await driver.execute(`${docsize}\n${docs}`);

        const ir = await introspect(driver);
        expect(ir.tables.map((t) => t.name)).toEqual(["docs_docsize"]);
        const next = `CREATE TABLE docs_docsize (id INTEGER PRIMARY KEY, x TEXT, y TEXT);\n${docs}`;
        const preview = await getMigrationPreview(client, next);
        expect(preview.statements).toEqual(['ALTER TABLE "docs_docsize" ADD COLUMN "y" TEXT;']);
      });

      // Modules without a dedicated handler (FTS3/FTS4 here) reserve shadow
      // table names they do not always create: an external-content FTS4 table
      // has no %_content table
      describe("next to a module without a handler", () => {
        const articles = "CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT);";
        const docs = 'CREATE VIRTUAL TABLE docs USING fts4(content="articles", title, body);';
        const docsContent = "CREATE TABLE docs_content (id INTEGER PRIMARY KEY, note TEXT);";

        it("is introspected and gets its column changes", async () => {
          await driver.execute(`${articles}\n${docsContent}\n${docs}`);

          const ir = await introspect(driver);
          expect(ir.tables.map((t) => t.name)).toEqual(["articles", "docs_content"]);

          const next = `${articles}
            CREATE TABLE docs_content (id INTEGER PRIMARY KEY, note TEXT, extra TEXT);
            ${docs}`;
          const preview = await getMigrationPreview(client, next);
          expect(preview.statements).toEqual([
            'ALTER TABLE "docs_content" ADD COLUMN "extra" TEXT;',
          ]);
        });

        // better-sqlite3 (defensive mode) refuses to create a table with a
        // reserved name next to the virtual table
        it.skipIf(clientName === "better-sqlite3")("is created", async () => {
          await driver.execute(`${articles}\n${docs}`);
          const next = `${articles}\n${docs}\n${docsContent}`;

          const res = await migrate(client, next);
          expect(res.success, res.err?.message).toBe(true);
          expect(res.statements).toEqual([docsContent]);
          expect(await columnsOf("docs_content")).toEqual(["id", "note"]);
          await expectIdempotent(next, {});
        });

        it("while its real shadow tables stay hidden, including after a rename", async () => {
          await driver.execute(`
            ${articles}
            ${docs}
            CREATE VIRTUAL TABLE own USING fts4(x);
            CREATE VIRTUAL TABLE tmp USING fts3(x);
            ALTER TABLE tmp RENAME TO renamed;
            CREATE VIRTUAL TABLE geo USING rtree(id, a, b);
          `);
          const ir = await introspect(driver);
          expect(ir.tables.map((t) => t.name)).toEqual(["articles"]);
        });

        // FTS3 creates its %_stat table on demand (automerge); renamed, it is
        // written with a double-quoted name
        it("while an FTS3 table's %_stat table stays hidden after a rename", async () => {
          await driver.execute(`
            CREATE VIRTUAL TABLE tmp USING fts3(x);
            INSERT INTO tmp (tmp) VALUES ('automerge=4');
            CREATE VIRTUAL TABLE own4 USING fts4(x, matchinfo=fts3);
            CREATE VIRTUAL TABLE ext4 USING fts4(x, content='');
          `);
          await driver.execute(`
            ALTER TABLE tmp RENAME TO renamed;
            ALTER TABLE own4 RENAME TO own4b;
            ALTER TABLE ext4 RENAME TO ext4b;
          `);
          const ir = await introspect(driver);
          expect(ir.tables.map((t) => t.name)).toEqual([]);
        });

        // A quoted name is a common way of writing any table name; FTS3/FTS4
        // are known not to create these shadow tables with these arguments
        describe.each([
          ['"docs_content"', "external content", docs],
          ["'docs_content'", "external content", docs],
          [
            '"docs_docsize"',
            "matchinfo=fts3",
            "CREATE VIRTUAL TABLE docs USING fts4(title, body, matchinfo=fts3);",
          ],
          [
            '"docs_content"',
            "no content",
            "CREATE VIRTUAL TABLE docs USING fts4(title, body, content='');",
          ],
        ])("written %s next to an FTS4 table with %s", (quoted, _what, fts) => {
          const name = quoted.slice(1, -1);
          const table = `CREATE TABLE ${quoted} (id INTEGER PRIMARY KEY, note TEXT);`;

          it("is introspected and gets its column changes", async () => {
            await driver.execute(`${articles}\n${table}\n${fts}`);

            const ir = await introspect(driver);
            expect(ir.tables.map((t) => t.name)).toEqual(["articles", name]);

            const next = `${articles}
              CREATE TABLE ${quoted} (id INTEGER PRIMARY KEY, note TEXT, extra TEXT);
              ${fts}`;
            const preview = await getMigrationPreview(client, next);
            expect(preview.statements).toEqual([`ALTER TABLE "${name}" ADD COLUMN "extra" TEXT;`]);
          });

          it("is dropped when the desired schema no longer declares it", async () => {
            await driver.execute(`${articles}\n${table}\n${fts}`);
            const preview = await getMigrationPreview(client, `${articles}\n${fts}`);
            expect(preview.statements).toEqual([`DROP TABLE IF EXISTS "${name}";`]);
            expect(preview.warnings.map((w) => w.type)).toEqual(["destructive"]);
          });

          it.skipIf(clientName === "better-sqlite3")("is created", async () => {
            await driver.execute(`${articles}\n${fts}`);
            const next = `${articles}\n${fts}\n${table}`;

            const res = await migrate(client, next);
            expect(res.success, res.err?.message).toBe(true);
            expect(res.statements).toEqual([table]);
            expect(await columnsOf(name)).toEqual(["id", "note"]);
            await expectIdempotent(next, {});
          });
        });
      });

      it("while a real shadow table stays hidden", async () => {
        await driver.execute(`
          CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT);
          CREATE VIRTUAL TABLE own USING fts5(body);
          CREATE VIRTUAL TABLE nosize USING fts5(body, columnsize=0);
          CREATE VIRTUAL TABLE ext USING fts5(body, content=t, content_rowid=id);
        `);
        const ir = await introspect(driver);
        expect(ir.tables.map((t) => t.name)).toEqual(["t"]);
      });
    });

    it("of a renamed virtual table are not dropped when the flag is off", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE tmp USING fts5(title);
        ALTER TABLE tmp RENAME TO docs;
        INSERT INTO docs (title) VALUES ('hello');
      `);

      const res = await migrate(client, "CREATE VIRTUAL TABLE docs USING fts5(title);");
      expect(res.success, res.err?.message).toBe(true);
      expect(res.statements).toEqual([]);
      const hits = await driver.query<{ title: string }>(
        "SELECT title FROM docs WHERE docs MATCH 'hello'",
      );
      expect(hits).toEqual([{ title: "hello" }]);
    });
  });

  describe("prepareNextDatabase", () => {
    it("is called once on the scratch client before the desired DDL runs", async () => {
      const calls: { isLive: boolean; tables: string[] }[] = [];

      const preview = await getMigrationPreview(client, `${places}\n${rtree2d}`, {
        ...manage,
        prepareNextDatabase: async (scratch) => {
          const rows = await getDriver(scratch).query<{ name: string }>(
            "SELECT name FROM sqlite_schema",
          );
          calls.push({ isLive: scratch === client, tables: rows.map((r) => r.name) });
        },
      });

      expect(calls).toEqual([{ isLive: false, tables: [] }]);
      expect(preview.statements).toEqual([places, rtree2d]);
    });
  });
});

// better-sqlite3 can register JavaScript virtual table modules, which stand in
// for an extension module (sqlite-vec, ...) that must be loaded on both the
// live and the scratch database
describe("virtual table from an extension module (better-sqlite3)", () => {
  let db: Database;

  beforeEach(async () => {
    db = await getBetterSqlite3Database();
    registerFactoryModule(db, "ext_module");
    db.exec("CREATE VIRTUAL TABLE ext USING ext_module(a, b);");
  });

  afterEach(() => {
    db.close();
  });

  const prepareNextDatabase = (scratch: SQLite) => {
    registerFactoryModule(scratch as Database, "ext_module");
  };

  it("fails with 'no such module' when the scratch database lacks the module", async () => {
    await expect(
      getMigrationPreview(db, "CREATE VIRTUAL TABLE ext USING ext_module(a, b);", manage),
    ).rejects.toThrow(/no such module/);
  });

  it("works once prepareNextDatabase loads the module", async () => {
    const preview = await getMigrationPreview(
      db,
      "CREATE VIRTUAL TABLE ext USING ext_module(a, b);",
      { ...manage, prepareNextDatabase },
    );
    expect(preview.statements).toEqual([]);
  });

  it("recreates the virtual table when its arguments change", async () => {
    const next = "CREATE VIRTUAL TABLE ext USING ext_module(a, b, c);";
    const res = await migrate(db, next, { ...manage, prepareNextDatabase });

    expect(res.success, res.err?.message).toBe(true);
    expect(res.statements).toEqual(['DROP TABLE IF EXISTS "ext";', next]);
    expect(db.prepare("SELECT k FROM ext").all()).toEqual([{ k: "a" }, { k: "b" }, { k: "c" }]);

    const again = await getMigrationPreview(db, next, { ...manage, prepareNextDatabase });
    expect(again.statements).toEqual([]);
  });
});

// A virtual table whose module is not loaded on the live connection: tables
// named `<virtual table>_*` are taken to be its shadow tables, except those
// the desired schema declares as regular tables
describe.each<[string, MigrationOptions, string]>([
  ["off", {}, ""],
  // The desired schema declares the virtual table, so the scratch database needs the module
  [
    "on",
    {
      ...manage,
      prepareNextDatabase: (scratch) => registerFactoryModule(scratch as Database, "mymod"),
    },
    "CREATE VIRTUAL TABLE vec USING mymod(x, y);",
  ],
])("virtual table whose module is not loaded (manageVirtualTables %s)", (_flag, options, vec) => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sqlrite-unloaded-"));
    const file = join(dir, "db.sqlite");
    const setup = new BetterSqlite3(file);
    registerFactoryModule(setup, "mymod");
    setup.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE VIRTUAL TABLE vec USING mymod(x, y);
      CREATE TABLE vec_meta (id INTEGER PRIMARY KEY, k TEXT);
      CREATE TABLE vec_items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
      INSERT INTO vec_items (id, label) VALUES (1, 'a'), (2, 'b');
    `);
    setup.close();
    // The module is not registered on the connection sqlrite migrates
    db = new BetterSqlite3(file);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const users = "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);";
  const meta = "CREATE TABLE vec_meta (id INTEGER PRIMARY KEY, k TEXT);";
  const items = "CREATE TABLE vec_items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);";

  it("does not touch declared tables that are unchanged", async () => {
    const next = `${users}\n${vec}\n${meta}\n${items}`;

    const res = await migrate(db, next, options);
    expect(res.success, res.err?.message).toBe(true);
    expect(res.statements).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it("applies changes to declared tables", async () => {
    const next = `
      ${users}
      ${vec}
      CREATE TABLE vec_meta (id INTEGER PRIMARY KEY, k TEXT, v TEXT);
      CREATE INDEX vec_meta_k ON vec_meta (k);
      ${items}
    `;

    const res = await migrate(db, next, options);
    expect(res.success, res.err?.message).toBe(true);
    expect(res.statements).toEqual([
      'ALTER TABLE "vec_meta" ADD COLUMN "v" TEXT;',
      "CREATE INDEX vec_meta_k ON vec_meta (k);",
    ]);
  });

  it("leaves undeclared tables alone and says so", async () => {
    // vec_items may be a shadow table of vec, so it is not renamed to items
    const next = `${users}\n${vec}\n${meta}\nCREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);`;

    const preview = await getMigrationPreview(db, next, options);
    expect(preview.statements).toEqual([
      "CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
    ]);
    expect(preview.warnings).toEqual([
      {
        type: "caution",
        message: expect.stringContaining(
          'Module "mymod" of virtual table "vec" is not loaded on this connection, so table(s) "vec_items" are taken to be its shadow tables',
        ),
      },
    ]);
  });
});
