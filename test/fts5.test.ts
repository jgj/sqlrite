import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Driver, getDriver } from "../src/driver";
import { migrate } from "../src/migrate";
import { type MigrationOptions, getMigrationPreview } from "../src/migration-statements";
import type { SQLite } from "../src/sqlite";
import { getBetterSqlite3Database, getLibsqlClient, getNodeSqliteDatabase } from "../src/sqlite";
import { loadTestCases } from "./load-test-cases";

// FTS5 tables with manageVirtualTables on, on every driver. Each test puts
// real rows in, migrates, then checks MATCH results and rowids, that no
// scratch tables are left behind, and that a second run emits nothing.

const manage: MigrationOptions = { manageVirtualTables: true };

describe.each([
  ["libsql", getLibsqlClient],
  ["better-sqlite3", getBetterSqlite3Database],
  ["node:sqlite", getNodeSqliteDatabase],
])("FTS5 using %s", (clientName, getClient) => {
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

  // rowids (and the named columns) of the rows matching `query`, by rowid
  async function match(table: string, query: string, columns: string[] = []) {
    const select = ["rowid", ...columns].join(", ");
    const rows = await driver.query<Record<string, unknown>>(
      `SELECT ${select} FROM "${table}" WHERE "${table}" MATCH '${query}' ORDER BY rowid`,
    );
    return rows.map((r) => (columns.length === 0 ? Number(r.rowid) : normalize(r)));
  }

  function normalize(row: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
    );
  }

  async function rows(sql: string) {
    return (await driver.query<Record<string, unknown>>(sql)).map(normalize);
  }

  async function storedSql(name: string) {
    const [row] = await driver.query<{ sql: string }>(
      `SELECT sql FROM sqlite_schema WHERE name = '${name}'`,
    );
    return row?.sql;
  }

  // Tables left behind by a recreate: parked or copied tables in main, and
  // anything in temp
  async function leftovers() {
    const main = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE name LIKE 'sqlrite%'",
    );
    const temp = await driver.query<{ name: string }>("SELECT name FROM sqlite_temp_schema");
    return [...main, ...temp].map((r) => r.name);
  }

  async function migrateTo(ddl: string, options: MigrationOptions = manage) {
    const res = await migrate(client, ddl, options);
    expect(res.success, `${res.err?.message}\n\t${res.statements.join("\n\t")}`).toBe(true);
    expect(await leftovers()).toEqual([]);
    return res;
  }

  async function expectIdempotent(ddl: string, options: MigrationOptions = manage) {
    const again = await getMigrationPreview(client, ddl, options);
    expect(again.statements).toEqual([]);
    expect(again.warnings).toEqual([]);
  }

  describe("own content", () => {
    const seed = `
      INSERT INTO notes (rowid, title, body) VALUES
        (5, 'running shoes', 'blue'),
        (10, 'deleted', 'gone'),
        (42, 'fast runs', 'red'),
        (100, 'walking', 'running late');
      DELETE FROM notes WHERE rowid = 10;
    `;

    it("adds a column, keeping the rows and their rowids", async () => {
      await driver.execute(`CREATE VIRTUAL TABLE notes USING fts5(title, body);\n${seed}`);
      const next = "CREATE VIRTUAL TABLE notes USING fts5(title, body, tags);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan).toMatchObject([
        { type: "recreate", reasons: [{ check: "fts5.columns" }] },
      ]);
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await rows("SELECT rowid, title, body, tags FROM notes ORDER BY rowid")).toEqual([
        { rowid: 5, title: "running shoes", body: "blue", tags: null },
        { rowid: 42, title: "fast runs", body: "red", tags: null },
        { rowid: 100, title: "walking", body: "running late", tags: null },
      ]);
      expect(await match("notes", "running")).toEqual([5, 100]);
      expect(await match("notes", "body: red")).toEqual([42]);
      expect(await storedSql("notes")).toBe(next.slice(0, -1));

      // New rows are indexed in the new column
      await driver.execute("INSERT INTO notes (rowid, title, tags) VALUES (7, 'x', 'urgent')");
      expect(await match("notes", "tags: urgent")).toEqual([7]);
      await expectIdempotent(next);
    });

    it("removes a column with a destructive warning, keeping the other columns", async () => {
      await driver.execute(`CREATE VIRTUAL TABLE notes USING fts5(title, body);\n${seed}`);
      const next = "CREATE VIRTUAL TABLE notes USING fts5(title);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        { type: "destructive", message: expect.stringContaining('Column(s) "body"') },
      ]);

      await migrateTo(next);
      expect(await rows("SELECT rowid, * FROM notes ORDER BY rowid")).toEqual([
        { rowid: 5, title: "running shoes" },
        { rowid: 42, title: "fast runs" },
        { rowid: 100, title: "walking" },
      ]);
      expect(await match("notes", "running")).toEqual([5]);
      await expectIdempotent(next);
    });

    it("re-indexes the rows when the tokenizer changes", async () => {
      await driver.execute(
        `CREATE VIRTUAL TABLE notes USING fts5(title, body, tokenize='porter');\n${seed}`,
      );
      expect(await match("notes", "run")).toEqual([5, 42, 100]);
      const next = "CREATE VIRTUAL TABLE notes USING fts5(title, body);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan).toMatchObject([
        { type: "recreate", reasons: [{ check: "fts5.tokenize" }] },
      ]);

      await migrateTo(next);
      // unicode61 does not stem: "run" no longer matches "running" or "runs"
      expect(await match("notes", "run")).toEqual([]);
      expect(await match("notes", "running")).toEqual([5, 100]);
      expect(await match("notes", "runs", ["title"])).toEqual([{ rowid: 42, title: "fast runs" }]);
      await expectIdempotent(next);
    });

    it("keeps the runtime settings stored in %_config", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE notes USING fts5(title, body);
        ${seed}
        INSERT INTO notes (notes, rank) VALUES ('rank', 'bm25(10.0, 1.0)');
        INSERT INTO notes (notes, rank) VALUES ('automerge', 8);
      `);
      const config = "SELECT k, v FROM notes_config ORDER BY k";
      const before = await rows(config);

      await migrateTo("CREATE VIRTUAL TABLE notes USING fts5(title, body, tokenize=porter);");
      expect(await rows(config)).toEqual(before);
      expect(before.map((r) => r.k)).toEqual(["automerge", "rank", "version"]);
    });

    // bm25() weights are given per column position
    describe("keeps custom bm25() weights on their columns", () => {
      async function ranked() {
        return (await rows("SELECT rowid FROM notes WHERE notes MATCH 'apple' ORDER BY rank")).map(
          (r) => r.rowid,
        );
      }
      const rank = async () => rows("SELECT v FROM notes_config WHERE k = 'rank'");

      it("when the columns are reordered", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE notes USING fts5(title, body);
          INSERT INTO notes (rowid, title, body) VALUES (1, 'apple', 'x x x'), (2, 'x x x', 'apple');
          INSERT INTO notes (notes, rank) VALUES ('rank', 'bm25(10.0, 1.0)');
        `);
        expect(await ranked()).toEqual([1, 2]);
        const next = "CREATE VIRTUAL TABLE notes USING fts5(body, title);";

        await migrateTo(next);
        expect(await rank()).toEqual([{ v: "bm25(1.0, 10.0)" }]);
        expect(await ranked()).toEqual([1, 2]);
        await expectIdempotent(next);
      });

      it("when a column other than the last is removed", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE notes USING fts5(tags, title, body);
          INSERT INTO notes (rowid, tags, title, body) VALUES (1, '', 'apple', 'x x x'), (2, '', 'x x x', 'apple');
          INSERT INTO notes (notes, rank) VALUES ('rank', 'bm25(0.0, 10.0, 1.0)');
        `);
        const next = "CREATE VIRTUAL TABLE notes USING fts5(title, body);";

        await migrateTo(next);
        expect(await rank()).toEqual([{ v: "bm25(10.0, 1.0)" }]);
        expect(await ranked()).toEqual([1, 2]);
        await expectIdempotent(next);
      });

      it("when a column is added in front, with the default weight", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE notes USING fts5(title, body);
          INSERT INTO notes (notes, rank) VALUES ('rank', 'bm25(10.0)');
        `);
        const next = "CREATE VIRTUAL TABLE notes USING fts5(tags, title, body);";

        await migrateTo(next);
        expect(await rank()).toEqual([{ v: "bm25(1.0, 10.0, 1.0)" }]);
        await expectIdempotent(next);
      });
    });

    it("copies the rows into a contentless table", async () => {
      await driver.execute(`CREATE VIRTUAL TABLE notes USING fts5(title, body);\n${seed}`);
      const next = "CREATE VIRTUAL TABLE notes USING fts5(title, body, content='');";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        { type: "destructive", message: expect.stringContaining("no longer stored") },
      ]);

      await migrateTo(next);
      expect(await match("notes", "running", ["title"])).toEqual([
        { rowid: 5, title: null },
        { rowid: 100, title: null },
      ]);
      await expectIdempotent(next);
    });
  });

  describe("contentless", () => {
    it("recreates with a destructive warning, leaving the index empty", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE tags USING fts5(label, content='');
        INSERT INTO tags (rowid, label) VALUES (1, 'alpha'), (2, 'beta');
      `);
      expect(await match("tags", "alpha")).toEqual([1]);
      const next = "CREATE VIRTUAL TABLE tags USING fts5(label, note, content='');";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        {
          type: "destructive",
          message: expect.stringContaining('Data in virtual table "tags" will be lost'),
        },
      ]);
      expect(preview.warnings[0]?.message).toContain("contentless");

      await migrateTo(next);
      expect(await match("tags", "alpha")).toEqual([]);
      await driver.execute("INSERT INTO tags (rowid, label, note) VALUES (3, 'gamma', 'x')");
      expect(await match("tags", "gamma")).toEqual([3]);
      await expectIdempotent(next);
    });
  });

  describe("external content", () => {
    const docs = "CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);";
    const seedDocs = `
      INSERT INTO docs (id, title, body) VALUES
        (3, 'hello world', 'running'),
        (7, 'goodbye', 'jumping'),
        (9, 'hello again', 'walked');
    `;
    const docsFts =
      "CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=docs, content_rowid=id);";

    it("indexes the existing rows when it is created", async () => {
      await driver.execute(`${docs}\n${seedDocs}`);
      const next = `${docs}\n${docsFts}`;

      await migrateTo(next);
      expect(await match("docs_fts", "hello", ["title"])).toEqual([
        { rowid: 3, title: "hello world" },
        { rowid: 9, title: "hello again" },
      ]);
      await expectIdempotent(next);
    });

    // The rebuild guard reads the main table, which FTS5 reads the rows from
    it("indexes the existing rows when a temp table has the content table's name", async () => {
      await driver.execute(`${docs}\n${seedDocs}\nCREATE TEMP TABLE docs (x TEXT);`);
      const next = `${docs}\n${docsFts}`;

      const res = await migrate(client, next, manage);
      expect(res.success, res.err?.message).toBe(true);
      expect(await match("docs_fts", "hello")).toEqual([3, 9]);
      await driver.execute("INSERT INTO docs_fts (docs_fts, rank) VALUES ('integrity-check', 1)");
    });

    it("says column values cannot be read back when it becomes contentless", async () => {
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      const next = `${docs}\nCREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content='');`;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        { type: "destructive", message: expect.stringContaining("cannot be read back") },
      ]);
      await migrateTo(next);
      expect(await match("docs_fts", "hello")).toEqual([3, 9]);
      await expectIdempotent(next);
    });

    it("rebuilds the index when an option changes", async () => {
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      await driver.execute("INSERT INTO docs_fts (docs_fts) VALUES ('rebuild')");
      expect(await match("docs_fts", "run")).toEqual([]);

      const next = `${docs}
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=docs, content_rowid=id, tokenize=porter);`;
      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan).toMatchObject([
        { type: "recreate", reasons: [{ check: "fts5.tokenize" }] },
      ]);
      expect(preview.statements.at(-1)).toMatch(
        /^INSERT INTO "docs_fts"\("docs_fts"\) SELECT 'rebuild'/,
      );
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await match("docs_fts", "run", ["title"])).toEqual([
        { rowid: 3, title: "hello world" },
      ]);
      expect(await match("docs_fts", "walk")).toEqual([9]);
      await expectIdempotent(next);
    });

    it("rebuilds the index after the content table is recreated (INTEGER PRIMARY KEY)", async () => {
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      await driver.execute("INSERT INTO docs_fts (docs_fts) VALUES ('rebuild')");
      const next = `
        CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT);
        ${docsFts}
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan.map((op) => `${op.type}:${(op.target ?? op.current)?.name}`)).toEqual([
        "recreate:docs",
        "rebuild:docs_fts",
      ]);
      expect(preview.plan[1]).toMatchObject({
        reasons: [{ check: "virtual_table.dependency_recreated" }],
      });

      await migrateTo(next);
      expect(await match("docs_fts", "hello", ["title", "body"])).toEqual([
        { rowid: 3, title: "hello world", body: "running" },
        { rowid: 9, title: "hello again", body: "walked" },
      ]);
      await expectIdempotent(next);
    });

    it("rebuilds the index after the content table is recreated with renumbered rowids", async () => {
      // Without an INTEGER PRIMARY KEY, a table recreate renumbers the rowids;
      // an index that is not rebuilt would return the wrong rows
      await driver.execute(`
        CREATE TABLE docs (title TEXT, body TEXT);
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=docs);
        INSERT INTO docs (rowid, title, body) VALUES
          (1, 'deleted one', ''),
          (2, 'hello world', 'running'),
          (3, 'deleted two', ''),
          (4, 'the lazy dog', 'sleeping'),
          (5, 'hello again', 'walked');
        DELETE FROM docs WHERE rowid IN (1, 3);
        INSERT INTO docs_fts (docs_fts) VALUES ('rebuild');
      `);
      expect(await match("docs_fts", "dog")).toEqual([4]);
      const next = `
        CREATE TABLE docs (title TEXT NOT NULL, body TEXT);
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=docs);
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan.map((op) => op.type)).toEqual(["recreate", "rebuild"]);

      await migrateTo(next);
      expect(await rows("SELECT rowid, title FROM docs ORDER BY rowid")).toEqual([
        { rowid: 1, title: "hello world" },
        { rowid: 2, title: "the lazy dog" },
        { rowid: 3, title: "hello again" },
      ]);
      expect(await match("docs_fts", "dog", ["title"])).toEqual([
        { rowid: 2, title: "the lazy dog" },
      ]);
      expect(await match("docs_fts", "hello", ["title"])).toEqual([
        { rowid: 1, title: "hello world" },
        { rowid: 3, title: "hello again" },
      ]);
      await expectIdempotent(next);
    });

    it("recreates the index with the new content= after the content table is renamed", async () => {
      await driver.execute(`
        ${docs}
        ${docsFts}
        CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
          INSERT INTO docs_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
        END;
        ${seedDocs}
      `);
      const articlesFts =
        "CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=articles, content_rowid=id)";
      const next = `
        CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
        ${articlesFts};
        CREATE TRIGGER docs_ai AFTER INSERT ON articles BEGIN
          INSERT INTO docs_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
        END;
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan.map((op) => `${op.type}:${(op.target ?? op.current)?.name}`)).toEqual([
        "drop:docs_ai",
        "rename:articles",
        "recreate:docs_fts",
        "create:docs_ai",
      ]);

      await migrateTo(next);
      expect(await storedSql("docs_fts")).toBe(articlesFts);
      expect(await match("docs_fts", "hello", ["title"])).toEqual([
        { rowid: 3, title: "hello world" },
        { rowid: 9, title: "hello again" },
      ]);
      await driver.execute("INSERT INTO articles (id, title, body) VALUES (12, 'hello there', '')");
      expect(await match("docs_fts", "there")).toEqual([12]);
      await expectIdempotent(next);
    });

    it("drops and creates a renamed index whose content table is renamed too", async () => {
      // content= differs, so the two index definitions are not a rename
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      await driver.execute("INSERT INTO docs_fts (docs_fts) VALUES ('rebuild')");
      const next = `
        CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
        CREATE VIRTUAL TABLE articles_fts USING fts5(title, body, content=articles, content_rowid=id);
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan.map((op) => `${op.type}:${(op.target ?? op.current)?.name}`)).toEqual([
        "drop:docs_fts",
        "rename:articles",
        "create:articles_fts",
      ]);
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await match("articles_fts", "hello")).toEqual([3, 9]);
      const names = await rows("SELECT name FROM sqlite_schema WHERE name LIKE 'docs%'");
      expect(names).toEqual([]);
      await expectIdempotent(next);
    });

    it("keeps the index when its content table is dropped, with a warning", async () => {
      // The desired schema still declares docs_fts over docs, but not docs.
      // SQLite accepts that (content= is resolved when the table is read), so
      // docs_fts is kept as declared and the drop is reported.
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      await driver.execute("INSERT INTO docs_fts (docs_fts) VALUES ('rebuild')");

      const preview = await getMigrationPreview(client, docsFts, manage);
      expect(preview.statements).toEqual(['DROP TABLE IF EXISTS "docs";']);
      expect(preview.warnings).toEqual([
        { type: "destructive", message: expect.stringContaining('Table "docs" will be dropped.') },
        {
          type: "destructive",
          message: expect.stringContaining(
            'virtual table "docs_fts" in the desired schema reads from it',
          ),
        },
      ]);

      await migrateTo(docsFts);
      expect(await storedSql("docs_fts")).toBe(docsFts.slice(0, -1));
      expect(await match("docs_fts", "hello")).toEqual([3, 9]);
      await expectIdempotent(docsFts);
    });

    it("does not warn about a dropped content table when virtual tables are unmanaged", async () => {
      await driver.execute(`${docs}\n${docsFts}`);
      const preview = await getMigrationPreview(client, docsFts);
      expect(preview.warnings).toHaveLength(1);
    });

    // SQLite accepts such a schema (content= is only read when the index is),
    // so the rebuild is skipped with a warning rather than failing
    it.each([
      ["an indexed column", "fts5(title, body, extra, content=docs, content_rowid=id)", '"extra"'],
      ["the content_rowid column", "fts5(title, body, content=docs, content_rowid=nope)", '"nope"'],
    ])(
      "is created over a content table that lacks %s without failing",
      async (_what, args, column) => {
        await driver.execute(`${docs}\n${seedDocs}`);
        const next = `${docs}\nCREATE VIRTUAL TABLE docs_fts USING ${args};`;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.warnings).toEqual([
          { type: "destructive", message: expect.stringContaining(column) },
        ]);
        await migrateTo(next);
        await expectIdempotent(next);
      },
    );

    it("is recreated over a content table that lacks one of its columns without failing", async () => {
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      const next = `${docs}
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, extra, content=docs, content_rowid=id);`;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        { type: "destructive", message: expect.stringContaining('"extra"') },
      ]);
      await migrateTo(next);
      await expectIdempotent(next);
    });

    it("recreates over a missing content table without failing", async () => {
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      const next =
        "CREATE VIRTUAL TABLE docs_fts USING fts5(title, content=docs, content_rowid=id);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings.map((w) => w.message)).toContainEqual(
        expect.stringContaining('content table "docs" does not exist in the desired schema'),
      );
      await migrateTo(next);
      await expectIdempotent(next);
    });

    describe("over a view", () => {
      const posts = `
        CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT, draft INTEGER NOT NULL DEFAULT 0);
        INSERT INTO posts (id, body, draft) VALUES (1, 'hello world', 0), (2, 'running late', 0);
      `;
      const postsTable =
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT, draft INTEGER NOT NULL DEFAULT 0);";
      const view = "CREATE VIEW pub AS SELECT id, body FROM posts WHERE draft = 0;";
      const fts = "CREATE VIRTUAL TABLE f USING fts5(body, content=pub, content_rowid=id);";

      it("indexes the view's rows when the view is created in the same migration", async () => {
        await driver.execute(posts);
        const next = `${postsTable}\n${view}\n${fts}`;

        await migrateTo(next);
        expect(await match("f", "hello")).toEqual([1]);
        await expectIdempotent(next);
      });

      it("rebuilds after the view is recreated when both change", async () => {
        await driver.execute(`${posts}\n${view}\n${fts}\nINSERT INTO f (f) VALUES ('rebuild');`);
        expect(await match("f", "running")).toEqual([2]);
        const next = `
          ${postsTable}
          CREATE VIEW pub AS SELECT id, body FROM posts WHERE draft <> 1;
          CREATE VIRTUAL TABLE f USING fts5(body, content=pub, content_rowid=id, tokenize=porter);
        `;

        await migrateTo(next);
        expect(await match("f", "run")).toEqual([2]);
        expect(await rows("SELECT count(*) AS n FROM f_docsize")).toEqual([{ n: 2 }]);
        await expectIdempotent(next);
      });

      // The index is unchanged, but the rows it reads are not: without a
      // rebuild it holds rowids its content no longer has ("missing row")
      it("rebuilds when only the view is redefined", async () => {
        await driver.execute(`
          ${posts}
          UPDATE posts SET draft = 1 WHERE id = 2;
          CREATE VIEW pub AS SELECT id, body FROM posts;
          ${fts}
          INSERT INTO f (f) VALUES ('rebuild');
        `);
        expect(await match("f", "hello OR running")).toEqual([1, 2]);
        const next = `${postsTable}\n${view}\n${fts}`;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.plan.at(-1)).toMatchObject({
          type: "rebuild",
          reasons: [{ check: "virtual_table.dependency_recreated" }],
        });
        expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

        await migrateTo(next);
        expect(await match("f", "hello OR running")).toEqual([1]);
        await expectIdempotent(next);
      });

      it("rebuilds when the view is replaced by a table of the same name", async () => {
        await driver.execute(`${posts}\n${view}\n${fts}\nINSERT INTO f (f) VALUES ('rebuild');`);
        const next = `
          ${postsTable}
          CREATE TABLE pub (id INTEGER PRIMARY KEY, body TEXT);
          ${fts}
        `;

        await migrateTo(next);
        expect(await match("f", "hello OR running")).toEqual([]);
        await driver.execute("INSERT INTO pub (id, body) VALUES (7, 'hello there')");
        await driver.execute("INSERT INTO f (rowid, body) VALUES (7, 'hello there')");
        expect(await match("f", "hello", ["body"])).toEqual([{ rowid: 7, body: "hello there" }]);
        await expectIdempotent(next);
      });

      it("rebuilds when the content table is renamed and a view takes its name", async () => {
        await driver.execute(`
          CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);
          INSERT INTO docs (id, body) VALUES (1, 'alpha'), (2, 'beta');
          CREATE VIRTUAL TABLE f USING fts5(body, content=docs, content_rowid=id);
          INSERT INTO f (f) VALUES ('rebuild');
        `);
        const next = `
          CREATE TABLE docs_src (id INTEGER PRIMARY KEY, body TEXT);
          CREATE VIEW docs AS SELECT id + 100 AS id, body FROM docs_src;
          CREATE VIRTUAL TABLE f USING fts5(body, content=docs, content_rowid=id);
        `;

        await migrateTo(next);
        expect(await match("f", "beta", ["body"])).toEqual([{ rowid: 102, body: "beta" }]);
        await expectIdempotent(next);
      });

      it("rebuilds when a table below the view is recreated with renumbered rowids", async () => {
        await driver.execute(`
          CREATE TABLE docs (title TEXT);
          INSERT INTO docs (rowid, title) VALUES (5, 'slow'), (9, 'fast');
          CREATE VIEW pub AS SELECT rowid AS id, title FROM docs;
          CREATE VIRTUAL TABLE s USING fts5(title, content=pub, content_rowid=id);
          INSERT INTO s (s) VALUES ('rebuild');
        `);
        const next = `
          CREATE TABLE docs (title TEXT NOT NULL);
          CREATE VIEW pub AS SELECT rowid AS id, title FROM docs;
          CREATE VIRTUAL TABLE s USING fts5(title, content=pub, content_rowid=id);
        `;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.plan.at(-1)).toMatchObject({
          type: "rebuild",
          reasons: [{ check: "virtual_table.dependency_recreated" }],
        });

        await migrateTo(next);
        const ids = await rows("SELECT id FROM pub WHERE title = 'fast'");
        expect(await match("s", "fast")).toEqual(ids.map((r) => r.id));
        await expectIdempotent(next);
      });

      it("rebuilds once when it is recreated over an unchanged view", async () => {
        await driver.execute(`${posts}\n${view}\n${fts}\nINSERT INTO f (f) VALUES ('rebuild');`);
        const next = `${postsTable}\n${view}
          CREATE VIRTUAL TABLE f USING fts5(body, content=pub, content_rowid=id, prefix=2);`;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.statements.filter((s) => s.includes("SELECT 'rebuild'"))).toHaveLength(1);
        expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

        await migrateTo(next);
        expect(await match("f", "hello OR running")).toEqual([1, 2]);
        await expectIdempotent(next);
      });

      // The content view reads another view, which the migration redefines
      describe("that reads a redefined view", () => {
        const current = `
          ${posts}
          UPDATE posts SET draft = 1 WHERE id = 2;
          CREATE VIEW base AS SELECT id, body FROM posts;
          CREATE VIEW pub AS SELECT id, body FROM base;
          ${fts}
          INSERT INTO f (f) VALUES ('rebuild');
        `;
        const nextViews = `
          ${postsTable}
          CREATE VIEW base AS SELECT id, body FROM posts WHERE draft = 0;
          CREATE VIEW pub AS SELECT id, body FROM base;
        `;

        it("rebuilds the index", async () => {
          await driver.execute(current);
          expect(await match("f", "hello OR running")).toEqual([1, 2]);
          const next = `${nextViews}\n${fts}`;

          const preview = await getMigrationPreview(client, next, manage);
          expect(preview.plan.at(-1)).toMatchObject({
            type: "rebuild",
            reasons: [{ check: "virtual_table.dependency_recreated" }],
          });
          expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

          await migrateTo(next);
          expect(await match("f", "hello OR running")).toEqual([1]);
          await expectIdempotent(next);
        });

        it("copies the rows it read into a new own-content table", async () => {
          await driver.execute(current);
          const next = `${nextViews}\nCREATE VIRTUAL TABLE f USING fts5(body);`;

          await migrateTo(next);
          expect(await rows("SELECT rowid, body FROM f ORDER BY rowid")).toEqual([
            { rowid: 1, body: "hello world" },
            { rowid: 2, body: "running late" },
          ]);
          expect(await match("f", "running")).toEqual([2]);
          await expectIdempotent(next);
        });
      });

      // FTS5 reads the view's rowid column when content_rowid is omitted
      it("reads a view's rowid column when content_rowid is omitted", async () => {
        await driver.execute(posts);
        const next = `${postsTable}
          CREATE VIEW pub AS SELECT id AS rowid, body FROM posts;
          CREATE VIRTUAL TABLE f USING fts5(body, content=pub);`;

        await migrateTo(next);
        expect(await match("f", "hello")).toEqual([1]);
        await expectIdempotent(next);
      });

      // A view without a rowid column cannot be read: the rebuild is skipped
      it("is recreated over a view without a rowid without failing", async () => {
        await driver.execute(`${posts}
          CREATE VIEW pub AS SELECT id, body FROM posts;
          CREATE VIRTUAL TABLE f USING fts5(body, content=pub);`);
        const next = `${postsTable}
          CREATE VIEW pub AS SELECT id, body FROM posts;
          CREATE VIRTUAL TABLE f USING fts5(body, content=pub, prefix=2);`;

        await migrateTo(next);
        await expectIdempotent(next);
      });

      it("keeps the index when its content table is replaced by a view of the same name", async () => {
        await driver.execute(`
          CREATE TABLE src (id INTEGER PRIMARY KEY, title TEXT);
          ${posts}
          CREATE VIRTUAL TABLE docs USING fts5(body, content=src, content_rowid=id);
        `);
        const next = `
          ${postsTable}
          CREATE VIEW src AS SELECT id, body FROM posts;
          CREATE VIRTUAL TABLE docs USING fts5(body, content=src, content_rowid=id);
        `;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.warnings.map((w) => w.message)).not.toContainEqual(
          expect.stringContaining("exists again"),
        );

        await migrateTo(next);
        expect(await match("docs", "hello")).toEqual([1]);
        await expectIdempotent(next);
      });
    });

    it("is created over a WITHOUT ROWID content table with a warning, without failing", async () => {
      const table = "CREATE TABLE t (k TEXT PRIMARY KEY, body TEXT) WITHOUT ROWID;";
      await driver.execute(`${table}\nINSERT INTO t VALUES ('1', 'hello');`);
      const next = `${table}\nCREATE VIRTUAL TABLE f USING fts5(body, content=t);`;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        { type: "destructive", message: expect.stringContaining("WITHOUT ROWID") },
      ]);
      await migrateTo(next);
      await expectIdempotent(next);
    });

    describe.each(["VIRTUAL", "STORED"])("over a %s generated column", (kind) => {
      const articles = `CREATE TABLE articles (
        id INTEGER PRIMARY KEY, title TEXT, body TEXT,
        search TEXT GENERATED ALWAYS AS (title || ' ' || body) ${kind}
      );`;
      const seed = "INSERT INTO articles (id, title, body) VALUES (1, 'hello', 'world');";
      const index =
        "CREATE VIRTUAL TABLE docs USING fts5(search, content=articles, content_rowid=id);";

      it("indexes it when the index is created", async () => {
        await driver.execute(`${articles}\n${seed}`);
        const next = `${articles}\n${index}`;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.warnings).toEqual([]);
        await migrateTo(next);
        expect(await match("docs", "hello")).toEqual([1]);
        await expectIdempotent(next);
      });

      it("rebuilds it when the index is recreated", async () => {
        await driver.execute(
          `${articles}\n${seed}\n${index}\nINSERT INTO docs (docs) VALUES ('rebuild');`,
        );
        const next = `${articles}
          CREATE VIRTUAL TABLE docs USING fts5(search, content=articles, content_rowid=id, tokenize=porter);`;

        await migrateTo(next);
        expect(await match("docs", "hello")).toEqual([1]);
        await expectIdempotent(next);
      });
    });

    it("is rebuilt when an FTS4 index over the same content table becomes FTS5", async () => {
      await driver.execute(`
        ${docs}
        ${seedDocs}
        CREATE VIRTUAL TABLE docs_fts USING fts4(title, body, content="docs");
        INSERT INTO docs_fts (docs_fts) VALUES ('rebuild');
      `);
      const next = `${docs}\n${docsFts}`;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        {
          type: "caution",
          message:
            'Virtual table "docs_fts" will be recreated because its module changes: fts4 → fts5.',
        },
        {
          type: "destructive",
          message: expect.stringContaining('Virtual table "docs_fts" will be dropped.'),
        },
      ]);

      await migrateTo(next);
      expect(await match("docs_fts", "hello")).toEqual([3, 9]);
      await expectIdempotent(next);
    });

    // An own-content table's %_content shadow table holds the name until the
    // table is dropped, so the new content table can only be created after
    describe("takes over the name of its own %_content table", () => {
      const fts =
        "CREATE VIRTUAL TABLE docs USING fts5(body, content=docs_content, content_rowid=id);";

      it("when the content table is created", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE docs USING fts5(body);
          INSERT INTO docs (rowid, body) VALUES (1, 'hello');
          INSERT INTO docs (docs, rank) VALUES ('rank', 'bm25(2.0)');
        `);
        const next = `CREATE TABLE docs_content (id INTEGER PRIMARY KEY, body TEXT);\n${fts}`;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.warnings.map((w) => w.type)).toEqual(["destructive"]);

        await migrateTo(next);
        expect(await match("docs", "hello")).toEqual([]);
        expect(await rows("SELECT v FROM docs_config WHERE k = 'rank'")).toEqual([
          { v: "bm25(2.0)" },
        ]);
        // better-sqlite3's defensive mode keeps a table named like a shadow
        // table read-only
        if (clientName !== "better-sqlite3") {
          await driver.execute("INSERT INTO docs_content (id, body) VALUES (4, 'hello again')");
          await driver.execute("INSERT INTO docs (docs) VALUES ('rebuild')");
          expect(await match("docs", "hello")).toEqual([4]);
        }
        await expectIdempotent(next);
      });

      it("when a table is renamed to it", async () => {
        await driver.execute(`
          CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
          INSERT INTO notes (id, body) VALUES (3, 'hello from notes');
          CREATE VIRTUAL TABLE docs USING fts5(body);
          INSERT INTO docs (rowid, body) VALUES (1, 'hello');
        `);
        const next = `CREATE TABLE docs_content (id INTEGER PRIMARY KEY, body TEXT);\n${fts}`;

        const res = await migrateTo(next);
        expect(res.statements).toContain('ALTER TABLE "notes" RENAME TO "docs_content";');
        expect(await match("docs", "hello")).toEqual([3]);
        await expectIdempotent(next);
      });
    });

    it("fills a new own-content table from the former content table under its new name", async () => {
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      const next = `
        CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body);
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.statements).toContain('ALTER TABLE "docs" RENAME TO "articles";');
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await match("docs_fts", "hello", ["title"])).toEqual([
        { rowid: 3, title: "hello world" },
        { rowid: 9, title: "hello again" },
      ]);
      await expectIdempotent(next);
    });

    it("fills a new own-content table from the former content view", async () => {
      await driver.execute(`
        ${docs}
        ${seedDocs}
        CREATE VIEW recent AS SELECT id, title FROM docs WHERE id > 5;
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, content=recent, content_rowid=id);
        INSERT INTO docs_fts (docs_fts) VALUES ('rebuild');
      `);
      const next = `
        ${docs}
        CREATE VIEW recent AS SELECT id, title FROM docs WHERE id > 5;
        CREATE VIRTUAL TABLE docs_fts USING fts5(title);
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await rows("SELECT rowid, title FROM docs_fts ORDER BY rowid")).toEqual([
        { rowid: 7, title: "goodbye" },
        { rowid: 9, title: "hello again" },
      ]);
      expect(await match("docs_fts", "hello")).toEqual([9]);
      await expectIdempotent(next);
    });

    // The rows are read through the view before the migration redefines it
    it("fills a new own-content table from the former content view when the view is redefined", async () => {
      await driver.execute(`
        ${docs}
        ${seedDocs}
        CREATE VIEW recent AS SELECT id, title FROM docs WHERE id > 5;
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, content=recent, content_rowid=id);
        INSERT INTO docs_fts (docs_fts) VALUES ('rebuild');
      `);
      const next = `
        ${docs}
        CREATE VIEW recent AS SELECT id, upper(title) AS title FROM docs WHERE id > 5;
        CREATE VIRTUAL TABLE docs_fts USING fts5(title);
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan.slice(0, 1)).toMatchObject([
        { type: "recreate", step: "drop", target: { name: "docs_fts" } },
      ]);

      await migrateTo(next);
      expect(await rows("SELECT rowid, title FROM docs_fts ORDER BY rowid")).toEqual([
        { rowid: 7, title: "goodbye" },
        { rowid: 9, title: "hello again" },
      ]);
      await expectIdempotent(next);
    });

    // The content table is renamed through a temporary name (a swap); its
    // rows are read under its final name
    it("fills a new own-content table from a former content table that swaps names", async () => {
      await driver.execute(`
        CREATE TABLE t1 (x);
        INSERT INTO t1 (rowid, x) VALUES (1, 'alpha'), (2, 'beta');
        CREATE VIRTUAL TABLE t2 USING fts5(y);
        CREATE VIRTUAL TABLE g USING fts5(x, content=t1);
        INSERT INTO g (g) VALUES ('rebuild');
      `);
      const next = `
        CREATE TABLE t2 (x);
        CREATE VIRTUAL TABLE t1 USING fts5(y);
        CREATE VIRTUAL TABLE g USING fts5(x);
      `;

      await migrateTo(next);
      expect(await rows("SELECT rowid, x FROM g ORDER BY rowid")).toEqual([
        { rowid: 1, x: "alpha" },
        { rowid: 2, x: "beta" },
      ]);
      await expectIdempotent(next);
    });

    it("fills a new own-content table from the former content table", async () => {
      await driver.execute(`${docs}\n${docsFts}\n${seedDocs}`);
      const next = `${docs}\nCREATE VIRTUAL TABLE docs_fts USING fts5(title, body);`;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await match("docs_fts", "hello", ["title"])).toEqual([
        { rowid: 3, title: "hello world" },
        { rowid: 9, title: "hello again" },
      ]);
      await expectIdempotent(next);
    });
  });

  describe("rename", () => {
    it("renames with ALTER TABLE, keeping rows, rowids and shadow tables", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE notes USING fts5(title, tokenize=porter);
        INSERT INTO notes (rowid, title) VALUES (4, 'running'), (8, 'walking');
      `);
      const next = "CREATE VIRTUAL TABLE memos USING fts5(title, tokenize='porter unicode61');";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.statements).toEqual(['ALTER TABLE "notes" RENAME TO "memos";']);
      expect(preview.warnings).toEqual([]);

      await migrateTo(next);
      expect(await storedSql("memos")).toBe(
        'CREATE VIRTUAL TABLE "memos" USING fts5(title, tokenize=porter)',
      );
      expect(await match("memos", "run", ["title"])).toEqual([{ rowid: 4, title: "running" }]);
      const tables = await rows(
        "SELECT name, type FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      expect(tables.map((t) => `${t.name}:${t.type}`)).toEqual([
        "memos:virtual",
        "memos_config:shadow",
        "memos_content:shadow",
        "memos_data:shadow",
        "memos_docsize:shadow",
        "memos_idx:shadow",
      ]);
      await expectIdempotent(next);
    });

    // A rename that frees a name another rename or create takes has to run first
    const regular = "(id INTEGER PRIMARY KEY, body TEXT)";
    it.each([
      [
        "a new table takes the old name",
        "CREATE VIRTUAL TABLE a USING fts5(body);",
        `CREATE VIRTUAL TABLE b USING fts5(body);\nCREATE TABLE a ${regular};`,
      ],
      [
        "a renamed table takes the old name",
        `CREATE TABLE x ${regular};\nCREATE VIRTUAL TABLE a USING fts5(body);`,
        `CREATE TABLE a ${regular};\nCREATE VIRTUAL TABLE b USING fts5(body);`,
      ],
      [
        "it takes the old name of a renamed table",
        `CREATE TABLE b ${regular};\nCREATE VIRTUAL TABLE a USING fts5(body);`,
        `CREATE TABLE c ${regular};\nCREATE VIRTUAL TABLE b USING fts5(body);`,
      ],
      [
        "it swaps names with a table",
        `CREATE TABLE a ${regular};\nCREATE VIRTUAL TABLE b USING fts5(body);`,
        `CREATE TABLE b ${regular};\nCREATE VIRTUAL TABLE a USING fts5(body);`,
      ],
      [
        "it takes the name a regular table held (the table is dropped)",
        `CREATE TABLE b ${regular};\nCREATE VIRTUAL TABLE a USING fts5(body);`,
        "CREATE VIRTUAL TABLE b USING fts5(body);",
      ],
      // The rename also takes and frees the names of the shadow tables
      [
        "a dropped table holds the name of one of its new shadow tables (_data)",
        `CREATE TABLE b_data ${regular};\nCREATE VIRTUAL TABLE a USING fts5(body);`,
        "CREATE VIRTUAL TABLE b USING fts5(body);",
      ],
      [
        "a dropped table holds the name of one of its new shadow tables (_config)",
        `CREATE TABLE b_config ${regular};\nCREATE VIRTUAL TABLE a USING fts5(body);`,
        "CREATE VIRTUAL TABLE b USING fts5(body);",
      ],
      [
        "a renamed table takes the name of one of its current shadow tables",
        `CREATE VIRTUAL TABLE a USING fts5(body);\nCREATE TABLE a_meta ${regular};`,
        `CREATE VIRTUAL TABLE b USING fts5(body);\nCREATE TABLE a_config ${regular};`,
      ],
      [
        "a renamed table frees the name of one of its new shadow tables",
        `CREATE VIRTUAL TABLE a USING fts5(body);\nCREATE TABLE b_config ${regular};`,
        `CREATE VIRTUAL TABLE b USING fts5(body);\nCREATE TABLE c ${regular};`,
      ],
      [
        "it takes the name of one of its own shadow tables",
        "CREATE VIRTUAL TABLE a USING fts5(body);",
        "CREATE VIRTUAL TABLE a_data USING fts5(body);",
      ],
      [
        "it takes the name of one of its own shadow tables (_config)",
        "CREATE VIRTUAL TABLE a USING fts5(body);",
        "CREATE VIRTUAL TABLE a_config USING fts5(body);",
      ],
      [
        "one of its new shadow tables takes its current name",
        "CREATE VIRTUAL TABLE a_data USING fts5(body);",
        "CREATE VIRTUAL TABLE a USING fts5(body);",
      ],
    ])("renames when %s", async (_case, current, next) => {
      await driver.execute(current);
      const fts = /VIRTUAL TABLE (\w+)/.exec(current)?.[1] ?? "";
      await driver.execute(`INSERT INTO ${fts} (rowid, body) VALUES (5, 'hello')`);
      const renamed = /VIRTUAL TABLE (\w+)/.exec(next)?.[1] ?? "";

      await migrateTo(next);
      expect(await match(renamed, "hello")).toEqual([5]);
      await expectIdempotent(next);
    });

    // A recreate that drops a shadow table whose name a new or renamed
    // virtual table takes has to drop it first. better-sqlite3's defensive
    // mode rejects such a desired schema.
    describe.skipIf(clientName === "better-sqlite3")(
      "when a virtual table takes the name of a recreated table's shadow table",
      () => {
        it("that is created", async () => {
          await driver.execute(`
            CREATE VIRTUAL TABLE docs USING fts5(t);
            INSERT INTO docs (rowid, t) VALUES (1, 'hello');
          `);
          const next = `
            CREATE VIRTUAL TABLE docs USING fts5(t, content='');
            CREATE VIRTUAL TABLE docs_content USING fts5(q);
          `;

          await migrateTo(next);
          expect(await match("docs", "hello")).toEqual([1]);
          await expectIdempotent(next);
        });

        it("that is renamed", async () => {
          await driver.execute(`
            CREATE VIRTUAL TABLE docs USING fts5(t);
            CREATE VIRTUAL TABLE other USING fts5(q);
            INSERT INTO other (rowid, q) VALUES (3, 'keep');
          `);
          const next = `
            CREATE VIRTUAL TABLE docs USING fts5(t, content='');
            CREATE VIRTUAL TABLE docs_content USING fts5(q);
          `;

          const res = await migrateTo(next);
          expect(res.statements).toContain('ALTER TABLE "other" RENAME TO "docs_content";');
          expect(await match("docs_content", "keep")).toEqual([3]);
          await expectIdempotent(next);
        });
      },
    );
  });

  describe("name case", () => {
    // SQLite matches table names case-insensitively: Docs and docs are the
    // same table, and ALTER TABLE "Docs" RENAME TO "docs" is rejected
    it("ignores a difference in case alone", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE Docs USING fts5(body);
        INSERT INTO Docs (rowid, body) VALUES (3, 'hello');
      `);
      const next = "CREATE VIRTUAL TABLE docs USING fts5(body);";

      const res = await migrateTo(next);
      expect(res.statements).toEqual([]);
      expect(await match("docs", "hello")).toEqual([3]);
      await expectIdempotent(next);
    });

    it("keeps the rows when the definition changes along with the case", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE Docs USING fts5(body);
        INSERT INTO Docs (rowid, body) VALUES (3, 'hello');
      `);
      const next = "CREATE VIRTUAL TABLE docs USING fts5(body, extra);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await match("docs", "hello", ["body"])).toEqual([{ rowid: 3, body: "hello" }]);
      await expectIdempotent(next);
    });

    // SQLite folds the case of ASCII letters only: "Ä" and "ä" are two names
    describe("of non-ASCII letters", () => {
      it("renames a table whose name differs only in it", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE "Ärger" USING fts5(body);
          INSERT INTO "Ärger" (rowid, body) VALUES (5, 'hello world'), (9, 'foo bar');
        `);
        const next = 'CREATE VIRTUAL TABLE "ärger" USING fts5(body);';

        const res = await migrateTo(next);
        expect(res.statements).toEqual(['ALTER TABLE "Ärger" RENAME TO "ärger";']);
        expect(await match("ärger", "hello")).toEqual([5]);
        await expectIdempotent(next);
      });

      it("creates a table next to one whose name differs only in it", async () => {
        await driver.execute('CREATE VIRTUAL TABLE "Ä" USING fts5(a);');
        const next =
          'CREATE VIRTUAL TABLE "Ä" USING fts5(a);\nCREATE VIRTUAL TABLE "ä" USING fts5(a);';

        const res = await migrateTo(next);
        expect(res.statements).toEqual(['CREATE VIRTUAL TABLE "ä" USING fts5(a);']);
        await expectIdempotent(next);
      });

      it("keeps two tables whose names differ only in it apart", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE "Ä" USING fts5(body);
          CREATE VIRTUAL TABLE "ä" USING fts5(body);
          INSERT INTO "Ä" (rowid, body) VALUES (1, 'upper');
          INSERT INTO "ä" (rowid, body) VALUES (2, 'lower running');
        `);
        const next = `
          CREATE VIRTUAL TABLE "Ä" USING fts5(body);
          CREATE VIRTUAL TABLE "ä" USING fts5(body, tokenize=porter);
        `;

        const preview = await getMigrationPreview(client, next, manage);
        expect(preview.plan).toMatchObject([
          { type: "recreate", target: { name: "ä" }, reasons: [{ check: "fts5.tokenize" }] },
        ]);
        await migrateTo(next);
        expect(await match("Ä", "upper")).toEqual([1]);
        expect(await match("ä", "run")).toEqual([2]);
        await expectIdempotent(next);
      });
    });
  });

  describe("equivalent definitions", () => {
    it("emit no statements for cosmetic differences", async () => {
      await driver.execute(`
        CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
        CREATE VIRTUAL TABLE a USING fts5(title, body UNINDEXED, tokenize='porter unicode61', prefix='2 3');
        CREATE VIRTUAL TABLE b USING fts5(title, body, content='docs', content_rowid='id', detail=column);
        CREATE VIRTUAL TABLE c USING fts5(title, content='', contentless_delete=1);
        CREATE VIRTUAL TABLE tmp USING fts5(title, columnsize=0, tokenize = "unicode61 remove_diacritics 1");
        ALTER TABLE tmp RENAME TO d;
        INSERT INTO a (title, body) VALUES ('hello', 'world');
      `);

      const next = `
        CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);
        create virtual table if not exists "a" using FTS5 (
          [title],
          "body" unindexed,
          PREFIX = 3, prefix = 2,
          TOKENIZE = porter
        );
        CREATE VIRTUAL TABLE b USING fts5(detail='COLUMN', content_rowid=ID, "title", content="DOCS", body);
        CREATE VIRTUAL TABLE c USING fts5(title, CONTENT = "", contentless_delete = '1');
        CREATE VIRTUAL TABLE d USING fts5(\`title\`, COLUMNSIZE = '0');
      `;

      await expectIdempotent(next);
      const res = await migrateTo(next);
      expect(res.statements).toEqual([]);
      expect(await match("a", "hello")).toEqual([1]);
    });

    it("emit no statements when only the quoting of tokenizer words differs", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE a USING fts5(body, tokenize="unicode61 'remove_diacritics' '2'");
        CREATE VIRTUAL TABLE b USING fts5(body, tokenize="'porter' 'ascii'");
        INSERT INTO b (rowid, body) VALUES (1, 'running');
      `);
      const next = `
        CREATE VIRTUAL TABLE a USING fts5(body, tokenize='unicode61 remove_diacritics 2');
        CREATE VIRTUAL TABLE b USING fts5(body, tokenize='porter ascii');
      `;

      await expectIdempotent(next);
      expect(await match("b", "run")).toEqual([1]);
    });
  });

  describe("with triggers and views", () => {
    const docs = "CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, body TEXT);";
    const triggers = `
      CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
        INSERT INTO docs_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
      CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
        INSERT INTO docs_fts (docs_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      END;
      CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
        INSERT INTO docs_fts (docs_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
        INSERT INTO docs_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
    `;
    const view =
      "CREATE VIEW hello_docs AS SELECT rowid AS id, title FROM docs_fts WHERE docs_fts MATCH 'hello';";

    async function helloDocs() {
      return (await rows("SELECT id FROM hello_docs ORDER BY id")).map((r) => r.id);
    }

    it("keeps sync triggers and views working across a content table recreate and an index recreate", async () => {
      await driver.execute(`
        ${docs}
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=docs, content_rowid=id);
        ${triggers}
        ${view}
        INSERT INTO docs (id, title, body) VALUES (3, 'hello world', 'running'), (7, 'goodbye', 'jumping');
      `);
      expect(await helloDocs()).toEqual([3]);

      const next = `
        CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT);
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=docs, content_rowid=id, tokenize=porter);
        ${triggers}
        ${view}
      `;
      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan.map((op) => `${op.type}:${(op.target ?? op.current)?.name}`)).toEqual([
        "recreate:docs",
        "recreate:docs_fts",
      ]);
      expect(preview.statements.filter((s) => s.startsWith("DROP VIEW"))).toEqual([
        'DROP VIEW IF EXISTS "hello_docs";',
      ]);

      await migrateTo(next);
      expect(await helloDocs()).toEqual([3]);
      expect(await match("docs_fts", "run")).toEqual([3]);

      // The sync triggers still maintain the index
      await driver.execute("INSERT INTO docs (id, title, body) VALUES (9, 'hello again', 'x')");
      expect(await helloDocs()).toEqual([3, 9]);
      await driver.execute("UPDATE docs SET title = 'farewell' WHERE id = 3");
      expect(await helloDocs()).toEqual([9]);
      await driver.execute("DELETE FROM docs WHERE id = 9");
      expect(await helloDocs()).toEqual([]);
      expect(await match("docs_fts", "farewell")).toEqual([3]);

      await expectIdempotent(next);
    });

    it("does not rewrite the triggers and views that reference a recreated own-content table", async () => {
      const notesTrigger = `CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts (rowid, body) VALUES (new.id, new.body);
        END`;
      const notesView =
        "CREATE VIEW long_notes AS SELECT rowid AS id, body FROM notes_fts WHERE length(body) > 5";
      await driver.execute(`
        CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
        CREATE VIRTUAL TABLE notes_fts USING fts5(body);
        ${notesTrigger};
        ${notesView};
        INSERT INTO notes (id, body) VALUES (1, 'short'), (2, 'a longer note');
      `);

      const next = `
        CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
        CREATE VIRTUAL TABLE notes_fts USING fts5(body, extra UNINDEXED);
        ${notesTrigger};
        ${notesView};
      `;
      await migrateTo(next);

      const [trigger] = await rows("SELECT sql FROM sqlite_schema WHERE name = 'notes_ai'");
      expect(trigger?.sql).toBe(notesTrigger);
      await driver.execute("INSERT INTO notes (id, body) VALUES (3, 'another long note')");
      expect(await match("notes_fts", "another")).toEqual([3]);
      expect(await rows("SELECT id FROM long_notes ORDER BY id")).toEqual([{ id: 2 }, { id: 3 }]);
      await expectIdempotent(next);
    });

    it("renames the index together with the triggers and views that reference it", async () => {
      await driver.execute(`
        ${docs}
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content=docs, content_rowid=id);
        ${triggers}
        ${view}
        INSERT INTO docs (id, title, body) VALUES (3, 'hello world', 'running');
      `);
      const rename = (sql: string) => sql.replaceAll("docs_fts", "search");
      const next = `
        ${docs}
        CREATE VIRTUAL TABLE search USING fts5(title, body, content=docs, content_rowid=id);
        ${rename(triggers)}
        ${rename(view)}
      `;

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.statements).toContain('ALTER TABLE "docs_fts" RENAME TO "search";');

      await migrateTo(next);
      await driver.execute("INSERT INTO docs (id, title, body) VALUES (9, 'hello again', 'x')");
      expect(await helloDocs()).toEqual([3, 9]);
      await expectIdempotent(next);
    });

    // Every ALTER TABLE checks the whole schema, so no view or trigger may
    // refer to a missing object while one runs
    it("puts back a recreated table's trigger and view after the index they use is renamed", async () => {
      await driver.execute(`
        CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);
        CREATE VIRTUAL TABLE s USING fts5(body);
        CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN INSERT INTO s (rowid, body) VALUES (new.id, new.body); END;
        CREATE VIEW v AS SELECT docs.id FROM docs JOIN s ON s.rowid = docs.id;
      `);
      const next = `
        CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
        CREATE VIRTUAL TABLE s2 USING fts5(body);
        CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN INSERT INTO s2 (rowid, body) VALUES (new.id, new.body); END;
        CREATE VIEW v AS SELECT docs.id FROM docs JOIN s2 ON s2.rowid = docs.id;
      `;

      await migrateTo(next);
      await driver.execute("INSERT INTO docs (id, body) VALUES (4, 'hello')");
      expect(await match("s2", "hello")).toEqual([4]);
      expect(await rows("SELECT id FROM v")).toEqual([{ id: 4 }]);
      await expectIdempotent(next);
    });

    it("puts back a recreated table's trigger after the index it uses is created", async () => {
      await driver.execute(`
        CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT);
        CREATE TABLE other (id INTEGER PRIMARY KEY, x TEXT);
      `);
      const next = `
        CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE other (id INTEGER PRIMARY KEY, x TEXT NOT NULL);
        CREATE VIRTUAL TABLE s USING fts5(body);
        CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN INSERT INTO s (rowid, body) VALUES (new.id, new.body); END;
      `;

      await migrateTo(next);
      await driver.execute("INSERT INTO docs (id, body) VALUES (4, 'hello')");
      expect(await match("s", "hello")).toEqual([4]);
      await expectIdempotent(next);
    });

    it("puts back a recreated table's view after a new index it joins, across a later DROP COLUMN", async () => {
      await driver.execute(`
        CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT);
        CREATE TABLE b (p, extra);
        CREATE VIEW v AS SELECT id FROM t;
      `);
      const next = `
        CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE b (p);
        CREATE VIRTUAL TABLE f USING fts5(body);
        CREATE VIEW v AS SELECT t.id FROM t JOIN f ON f.rowid = t.id;
      `;

      await migrateTo(next);
      expect(await rows("SELECT * FROM v")).toEqual([]);
      await expectIdempotent(next);
    });

    it("drops a view over a recreated index before other tables are altered", async () => {
      await driver.execute(`
        CREATE TABLE a (x);
        CREATE TABLE b (p, extra);
        CREATE VIRTUAL TABLE f USING fts5(body);
        INSERT INTO f (rowid, body) VALUES (1, 'hello');
        CREATE VIEW v AS SELECT body, x FROM f, a;
      `);
      const next = `
        CREATE TABLE b (p);
        CREATE VIRTUAL TABLE f USING fts5(body, tokenize=porter);
        CREATE VIEW v AS SELECT body FROM f;
      `;

      await migrateTo(next);
      expect(await rows("SELECT body FROM v")).toEqual([{ body: "hello" }]);
      await expectIdempotent(next);
    });

    it("drops and puts back a view that reads a view over the renamed index", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE s USING fts5(body);
        INSERT INTO s (rowid, body) VALUES (1, 'hello');
        CREATE VIEW v1 AS SELECT body FROM s;
        CREATE VIEW v2 AS SELECT body FROM v1;
      `);
      const next = `
        CREATE VIRTUAL TABLE s2 USING fts5(body);
        CREATE VIEW v1 AS SELECT body FROM s2;
        CREATE VIEW v2 AS SELECT body FROM v1;
      `;

      await migrateTo(next);
      expect(await rows("SELECT body FROM v2")).toEqual([{ body: "hello" }]);
      await expectIdempotent(next);
    });

    // SQLite drops the triggers on a view together with the view
    describe("INSTEAD OF triggers on a view over a recreated index", () => {
      const trigger = `CREATE TRIGGER dv_ins INSTEAD OF INSERT ON dv BEGIN
          INSERT INTO s (rowid, body) VALUES (NEW.id, NEW.body);
        END;`;
      const view = "CREATE VIEW dv AS SELECT rowid AS id, body FROM s;";
      const next = `
        CREATE VIRTUAL TABLE s USING fts5(body, prefix=2);
        ${view}
        ${trigger}
      `;

      it("creates a new trigger once the view is back", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE s USING fts5(body);
          ${view}
          INSERT INTO s (rowid, body) VALUES (1, 'hello');
        `);

        await migrateTo(next);
        await driver.execute("INSERT INTO dv (id, body) VALUES (2, 'hello again')");
        expect(await match("s", "hello")).toEqual([1, 2]);
        await expectIdempotent(next);
      });

      it("puts back an existing trigger", async () => {
        await driver.execute(`
          CREATE VIRTUAL TABLE s USING fts5(body);
          ${view}
          ${trigger}
          INSERT INTO s (rowid, body) VALUES (1, 'hello');
        `);

        await migrateTo(next);
        await driver.execute("INSERT INTO dv (id, body) VALUES (2, 'hello again')");
        expect(await match("s", "hello")).toEqual([1, 2]);
        await expectIdempotent(next);
      });
    });

    // Every ALTER TABLE checks the triggers, so a trigger that writes to an
    // index must not be left in place while the index is missing
    describe("keeps a trigger that writes to an index missing while tables are altered", () => {
      const articles = "CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT);";
      const articlesView = "CREATE VIEW articles_v AS SELECT id, title FROM articles;";
      const trigger = `CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
          INSERT INTO docs (rowid, title) VALUES (new.id, new.title);
        END;`;
      const fromView =
        "CREATE VIRTUAL TABLE docs USING fts5(title, content=articles_v, content_rowid=id);";
      const own = "CREATE VIRTUAL TABLE docs USING fts5(title);";

      it.each([
        [
          "the index is recreated in two steps and a table is renamed",
          `${articles}\n${articlesView}\nCREATE TABLE other (x);\n${fromView}\n${trigger}`,
          `${articles}\n${articlesView}\nCREATE TABLE other2 (x);\n${own}\n${trigger}`,
        ],
        [
          "the index is recreated in two steps and a table is recreated",
          `${articles}\n${articlesView}\nCREATE TABLE other (x);\n${fromView}\n${trigger}`,
          `${articles}\n${articlesView}\nCREATE TABLE other (x INTEGER NOT NULL DEFAULT 0);\n${own}\n${trigger}`,
        ],
        [
          "the index is recreated in two steps and a column is dropped",
          `${articles}\n${articlesView}\nCREATE TABLE other (x, y);\n${fromView}\n${trigger}`,
          `${articles}\n${articlesView}\nCREATE TABLE other (x);\n${own}\n${trigger}`,
        ],
        [
          "the index is replaced by a table and a table is renamed",
          `${articles}\nCREATE TABLE other (x);\n${own}\n${trigger}`,
          `${articles}\nCREATE TABLE other2 (x);\nCREATE TABLE docs (title TEXT);\n${trigger}`,
        ],
        [
          "a table is replaced by the index and a column is dropped",
          `${articles}\nCREATE TABLE other (x, y);\nCREATE TABLE docs (title TEXT);\n${trigger}`,
          `${articles}\nCREATE TABLE other (x);\n${own}\n${trigger}`,
        ],
      ])("when %s", async (_case, current, next) => {
        await driver.execute(current);

        await migrateTo(next);
        await driver.execute("INSERT INTO articles (id, title) VALUES (5, 'hello')");
        expect(await rows("SELECT rowid FROM docs WHERE title = 'hello'")).toEqual([{ rowid: 5 }]);
        await expectIdempotent(next);
      });
    });
  });

  // contentless_unindexed needs SQLite 3.47; libsql ships 3.45
  describe.skipIf(clientName === "libsql")("contentless_unindexed", () => {
    const table =
      "CREATE VIRTUAL TABLE tags USING fts5(label, note UNINDEXED, content='', contentless_unindexed=1);";

    async function catalog() {
      const tables = await rows(
        "SELECT name FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      return tables.map((t) => t.name);
    }

    it("recreates although SQLite leaves the content table behind on DROP", async () => {
      await driver.execute(
        `${table}\nINSERT INTO tags (rowid, label, note) VALUES (1, 'alpha', 'kept');`,
      );
      const next =
        "CREATE VIRTUAL TABLE tags USING fts5(label, note UNINDEXED, extra, content='', contentless_unindexed=1);";

      await migrateTo(next);
      await driver.execute("INSERT INTO tags (rowid, label, note) VALUES (2, 'beta', 'n2')");
      expect(await rows("SELECT rowid, note FROM tags WHERE tags MATCH 'beta'")).toEqual([
        { rowid: 2, note: "n2" },
      ]);
      await expectIdempotent(next);
    });

    it("leaves the connection's legacy_alter_table setting as it was", async () => {
      await driver.execute(`PRAGMA legacy_alter_table = ON;\n${table}`);
      const next =
        "CREATE VIRTUAL TABLE tags USING fts5(label, note UNINDEXED, content='', contentless_unindexed=1, prefix=2);";

      const res = await migrateTo(next);
      expect(res.statements).toContain("PRAGMA legacy_alter_table = OFF;");
      expect(await rows("PRAGMA legacy_alter_table")).toEqual([{ legacy_alter_table: 1 }]);
      await expectIdempotent(next);
    });

    it("drops without leaving the content table behind", async () => {
      await driver.execute(table);
      await migrateTo("");
      expect(await catalog()).toEqual([]);
      await expectIdempotent("");
    });

    it("drops without leaving the content table behind when the module changes", async () => {
      await driver.execute(
        `${table}\nINSERT INTO tags (rowid, label, note) VALUES (1, 'alpha', 'kept');`,
      );
      const next = "CREATE VIRTUAL TABLE tags USING fts4(label, note);";

      await migrateTo(next);
      await driver.execute("INSERT INTO tags (label, note) VALUES ('beta', 'n2')");
      expect(await rows("SELECT note FROM tags WHERE tags MATCH 'beta'")).toEqual([{ note: "n2" }]);
      await expectIdempotent(next);
    });

    it("says which stored values are lost when it gets its own content", async () => {
      await driver.execute(
        `${table}\nINSERT INTO tags (rowid, label, note) VALUES (1, 'alpha', 'kept');`,
      );
      const next = "CREATE VIRTUAL TABLE tags USING fts5(label, note UNINDEXED);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toHaveLength(1);
      expect(preview.warnings[0]?.type).toBe("destructive");
      expect(preview.warnings[0]?.message).toContain(
        'its indexed columns are not stored, and the values stored for its UNINDEXED column(s) "note" are not copied',
      );
      expect(preview.warnings[0]?.message).not.toContain("cannot be read back");
    });

    it("says only the indexed values are lost when it stops storing its own content", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE tags USING fts5(label, note UNINDEXED);
        INSERT INTO tags (rowid, label, note) VALUES (1, 'alpha', 'kept');
      `);

      const preview = await getMigrationPreview(client, table, manage);
      expect(preview.warnings).toHaveLength(1);
      expect(preview.warnings[0]?.type).toBe("destructive");
      expect(preview.warnings[0]?.message).toContain('indexed column(s) "label"');
      expect(preview.warnings[0]?.message).toContain('UNINDEXED column(s) "note" are kept');

      await migrateTo(table);
      expect(await rows("SELECT rowid, note FROM tags WHERE tags MATCH 'alpha'")).toEqual([
        { rowid: 1, note: "kept" },
      ]);
      await expectIdempotent(table);
    });

    it("is dropped and created instead of renamed", async () => {
      await driver.execute(
        `${table}\nINSERT INTO tags (rowid, label, note) VALUES (1, 'alpha', 'kept');`,
      );
      const next = table.replace("tags", "labels");

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.plan.map((op) => op.type)).toEqual(["drop", "create"]);

      await migrateTo(next);
      expect(await catalog()).toEqual([
        "labels",
        "labels_config",
        "labels_content",
        "labels_data",
        "labels_docsize",
        "labels_idx",
      ]);
      await expectIdempotent(next);
    });
  });

  // locale=1 needs SQLite 3.47; libsql ships 3.45
  describe.skipIf(clientName === "libsql")("locale=1", () => {
    const table = "CREATE VIRTUAL TABLE f USING fts5(body, note UNINDEXED, locale=1);";
    const seed = `
      INSERT INTO f (rowid, body, note) VALUES (1, fts5_locale('en', 'hello world'), 'n1');
      INSERT INTO f (rowid, body, note) VALUES (2, fts5_locale('de', 'hallo welt'), 'n2');
      INSERT INTO f (rowid, body, note) VALUES (3, 'plain', 'n3');
    `;
    const locales = () =>
      rows("SELECT rowid, body, note, fts5_get_locale(f, 0) AS locale FROM f ORDER BY rowid");

    it("keeps the locale of each value across a recreate", async () => {
      await driver.execute(`${table}\n${seed}`);
      const before = await locales();
      expect(before.map((r) => r.locale)).toEqual(["en", "de", null]);
      const next = "CREATE VIRTUAL TABLE f USING fts5(body, note UNINDEXED, locale=1, prefix=2);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings.map((w) => w.type)).toEqual(["caution"]);

      await migrateTo(next);
      expect(await locales()).toEqual(before);
      expect(await match("f", "hello")).toEqual([1]);
      await expectIdempotent(next);
    });

    // The locale is read by the column's position in the current table
    it("keeps the locale of each value when a column before it is dropped", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE f USING fts5(a, b, locale=1);
        INSERT INTO f (rowid, a, b) VALUES (1, fts5_locale('en', 'x'), fts5_locale('de', 'y'));
      `);
      const next = "CREATE VIRTUAL TABLE f USING fts5(b, locale=1);";

      await migrateTo(next);
      expect(await rows("SELECT rowid, b, fts5_get_locale(f, 0) AS locale FROM f")).toEqual([
        { rowid: 1, b: "y", locale: "de" },
      ]);
      await expectIdempotent(next);
    });

    it("keeps the locale of each value when the columns are reordered", async () => {
      await driver.execute(`
        CREATE VIRTUAL TABLE f USING fts5(a, b, locale=1);
        INSERT INTO f (rowid, a, b) VALUES (1, fts5_locale('en', 'x'), fts5_locale('de', 'y'));
      `);
      const next = "CREATE VIRTUAL TABLE f USING fts5(b, a, locale=1);";

      await migrateTo(next);
      expect(
        await rows("SELECT a, b, fts5_get_locale(f, 0) AS lb, fts5_get_locale(f, 1) AS la FROM f"),
      ).toEqual([{ a: "x", b: "y", lb: "de", la: "en" }]);
      await expectIdempotent(next);
    });

    it("says the locales are lost when the new table does not store them", async () => {
      await driver.execute(`${table}\n${seed}`);
      const next = "CREATE VIRTUAL TABLE f USING fts5(body, note UNINDEXED);";

      const preview = await getMigrationPreview(client, next, manage);
      expect(preview.warnings).toEqual([
        { type: "destructive", message: expect.stringContaining("locale") },
      ]);

      await migrateTo(next);
      expect(await rows("SELECT rowid, body FROM f ORDER BY rowid")).toEqual([
        { rowid: 1, body: "hello world" },
        { rowid: 2, body: "hallo welt" },
        { rowid: 3, body: "plain" },
      ]);
      await expectIdempotent(next);
    });
  });

  // The FTS5 integration cases run with default options in
  // test/integration.test.ts; run them with virtual tables managed as well
  describe("integration cases with manageVirtualTables on", async () => {
    const cases = (await loadTestCases()).filter((c) => /fts5|virtual_table/.test(c.filename));

    it.each(cases)(
      "$filename migrates and is idempotent",
      async ({ current, next, expectNoStatements }) => {
        await driver.execute(current);
        const res = await migrateTo(next);
        if (expectNoStatements) expect(res.statements).toEqual([]);
        await expectIdempotent(next);
      },
    );
  });
});
