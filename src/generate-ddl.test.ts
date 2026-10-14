import { describe, expect, it } from "vitest";
import { generateDDL } from "./generate-ddl";
import type { IntrospectionResult } from "./introspection-result";
import type { Column, Index, Table, Trigger, View, VirtualTable } from "./introspection-result";
import type { MigrationPlan } from "./migration-plan";
import { registerVirtualTableModule } from "./virtual-tables/registry";

describe("generateDDL", () => {
  // Helper to create a minimal introspection result object
  function createIntrospection(partial: Partial<IntrospectionResult>): IntrospectionResult {
    return Object.assign(createEmptyIntrospection(), partial);
  }
  function createEmptyIntrospection(): IntrospectionResult {
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

  describe("basic operations", () => {
    it("should generate DDL for an empty migration plan", () => {
      const plan: MigrationPlan = [];
      const current = createEmptyIntrospection();
      const desired = createEmptyIntrospection();

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toEqual([]);
    });
  });

  describe("table operations", () => {
    it("should generate SQL for creating a table", () => {
      const table: Table = {
        type: "table",
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        views: [],
        num_cols: 2,
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: table,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        tables: [table],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");
    });

    it("should generate SQL for dropping a table", () => {
      const table: Table = {
        type: "table",
        name: "old_table",
        sql: "CREATE TABLE old_table (id INTEGER PRIMARY KEY)",
        views: [],
        num_cols: 1,
      };

      const plan: MigrationPlan = [
        {
          type: "drop",
          current: table,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        tables: [table],
      };
      const desired = createEmptyIntrospection();

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('DROP TABLE IF EXISTS "old_table";');
    });

    it("should generate SQL for renaming a table", () => {
      const currentTable: Table = {
        type: "table",
        name: "old_name",
        sql: "CREATE TABLE old_name (id INTEGER PRIMARY KEY)",
        views: [],
        num_cols: 1,
      };

      const targetTable: Table = {
        type: "table",
        name: "new_name",
        sql: "CREATE TABLE new_name (id INTEGER PRIMARY KEY)",
        views: [],
        num_cols: 1,
      };

      const plan: MigrationPlan = [
        {
          type: "rename",
          current: currentTable,
          target: targetTable,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        tables: [currentTable],
      };

      const desired = {
        ...createEmptyIntrospection(),
        tables: [targetTable],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('ALTER TABLE "old_name" RENAME TO "new_name";');
    });
  });

  describe("column operations", () => {
    it("should generate SQL for adding a column", () => {
      const column: Column = {
        type: "column",
        name: "email",
        table: "users",
        data_type: "text",
        ordinal_position: 3,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: column,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        columns: [column],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('ALTER TABLE "users" ADD COLUMN "email" TEXT;');
    });

    it("should generate SQL for adding a column with constraints", () => {
      const column: Column = {
        type: "column",
        name: "email",
        table: "users",
        data_type: "varchar",
        ordinal_position: 3,
        nullable: false,
        character_maximum_length: 255,
        precision: null,
        default: "'user@example.com'",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: column,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        columns: [column],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain(
        'ALTER TABLE "users" ADD COLUMN "email" VARCHAR(255) NOT NULL DEFAULT \'user@example.com\';',
      );
    });

    it("should generate SQL for adding a column with numeric precision", () => {
      const column: Column = {
        type: "column",
        name: "price",
        table: "products",
        data_type: "decimal",
        ordinal_position: 3,
        nullable: true,
        character_maximum_length: null,
        precision: { precision: 10, scale: 2 },
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: column,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        columns: [column],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('ALTER TABLE "products" ADD COLUMN "price" DECIMAL(10,2);');
    });

    it("should generate SQL for dropping a column", () => {
      const column: Column = {
        type: "column",
        name: "phone",
        table: "users",
        data_type: "text",
        ordinal_position: 4,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };

      const plan: MigrationPlan = [
        {
          type: "drop",
          current: column,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        columns: [column],
      };
      const desired = createEmptyIntrospection();

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('ALTER TABLE "users" DROP COLUMN "phone";');
    });

    it("should generate SQL for renaming a column", () => {
      const currentColumn: Column = {
        type: "column",
        name: "old_name",
        table: "users",
        data_type: "text",
        ordinal_position: 2,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };

      const targetColumn: Column = {
        type: "column",
        name: "new_name",
        table: "users",
        data_type: "text",
        ordinal_position: 2,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };

      const plan: MigrationPlan = [
        {
          type: "rename",
          current: currentColumn,
          target: targetColumn,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        columns: [currentColumn],
      };

      const desired = {
        ...createEmptyIntrospection(),
        columns: [targetColumn],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('ALTER TABLE "users" RENAME COLUMN "old_name" TO "new_name";');
    });
  });

  describe("index operations", () => {
    it("should generate SQL for creating an index", () => {
      const index: Index = {
        type: "index",
        name: "idx_users_email",
        table: "users",
        columns: ["email"],
        unique: false,
        sql: "CREATE INDEX idx_users_email ON users(email)",
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: index,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        indices: [index],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain("CREATE INDEX idx_users_email ON users(email);");
    });

    it("should generate SQL for creating a unique index", () => {
      const index: Index = {
        type: "index",
        name: "idx_users_email_unique",
        table: "users",
        columns: ["email"],
        unique: true,
        sql: null,
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: index,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        indices: [index],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('CREATE UNIQUE INDEX "idx_users_email_unique" ON "users" ("email");');
    });

    it("should generate SQL for dropping an index", () => {
      const index: Index = {
        type: "index",
        name: "idx_users_name",
        table: "users",
        columns: ["name"],
        unique: false,
        sql: "CREATE INDEX idx_users_name ON users(name)",
      };

      const plan: MigrationPlan = [
        {
          type: "drop",
          current: index,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        indices: [index],
      };

      const desired = createEmptyIntrospection();

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('DROP INDEX IF EXISTS "idx_users_name";');
    });
  });

  describe("trigger operations", () => {
    it("should generate SQL for creating a trigger", () => {
      const trigger: Trigger = {
        type: "trigger",
        name: "trg_users_after_insert",
        table: "users",
        sql: "CREATE TRIGGER trg_users_after_insert AFTER INSERT ON users BEGIN INSERT INTO audit_log VALUES (new.id, 'insert'); END;",
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: trigger,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        triggers: [trigger],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain(
        "CREATE TRIGGER trg_users_after_insert AFTER INSERT ON users BEGIN INSERT INTO audit_log VALUES (new.id, 'insert'); END;",
      );
    });

    it("should generate SQL for dropping a trigger", () => {
      const trigger: Trigger = {
        type: "trigger",
        name: "trg_users_after_update",
        table: "users",
        sql: "CREATE TRIGGER trg_users_after_update AFTER UPDATE ON users BEGIN INSERT INTO audit_log VALUES (new.id, 'update'); END;",
      };

      const plan: MigrationPlan = [
        {
          type: "drop",
          current: trigger,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        triggers: [trigger],
      };

      const desired = createEmptyIntrospection();

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('DROP TRIGGER IF EXISTS "trg_users_after_update";');
    });
  });

  describe("view operations", () => {
    it("should generate SQL for creating a view", () => {
      const view: View = {
        type: "view",
        name: "active_users",
        sql: "CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1",
        tables: ["users"],
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: view,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        views: [view],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain("CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1;");
    });

    it("should generate SQL for dropping a view", () => {
      const view: View = {
        type: "view",
        name: "user_emails",
        sql: "CREATE VIEW user_emails AS SELECT id, email FROM users",
        tables: ["users"],
      };

      const plan: MigrationPlan = [
        {
          type: "drop",
          current: view,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        views: [view],
      };

      const desired = createEmptyIntrospection();

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('DROP VIEW IF EXISTS "user_emails";');
    });
  });

  describe("complex operations", () => {
    it("should handle table recreation with data migration", () => {
      const currentTable: Table = {
        type: "table",
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
        views: [],
        num_cols: 2,
      };

      const targetTable: Table = {
        type: "table",
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE)",
        views: [],
        num_cols: 3,
      };

      const currentColumns: Column[] = [
        {
          type: "column",
          name: "id",
          table: "users",
          data_type: "INTEGER",
          ordinal_position: 1,
          nullable: false,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none",
        },
        {
          type: "column",
          name: "name",
          table: "users",
          data_type: "TEXT",
          ordinal_position: 2,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none",
        },
      ];

      const targetColumns: Column[] = [
        ...currentColumns,
        {
          type: "column",
          name: "email",
          table: "users",
          data_type: "TEXT",
          ordinal_position: 3,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none",
        },
      ];

      const plan: MigrationPlan = [
        {
          type: "recreate",
          current: currentTable,
          target: targetTable,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        tables: [currentTable],
        columns: currentColumns,
      };

      const desired = {
        ...createEmptyIntrospection(),
        tables: [targetTable],
        columns: targetColumns,
      };

      const ddl = generateDDL(plan, current, desired);

      // Check that the recreation sequence is correct
      expect(ddl).toContain(
        'CREATE TABLE "temp_users" (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE);',
      );
      expect(ddl).toContain(
        'INSERT INTO "temp_users" ("id", "name") SELECT "id", "name" FROM "users";',
      );
      expect(ddl).toContain('DROP TABLE "users";');
      expect(ddl).toContain('ALTER TABLE "temp_users" RENAME TO "users";');
    });

    it("should handle constraint changes with table recreation", () => {
      const currentTable: Table = {
        type: "table",
        name: "events",
        sql: "CREATE TABLE events (id INTEGER PRIMARY KEY, status TEXT DEFAULT 'pending' CHECK(status IN ('pending','done')))",
        views: [],
        num_cols: 2,
      };

      const targetTable: Table = {
        type: "table",
        name: "events",
        sql: "CREATE TABLE events (id INTEGER PRIMARY KEY, status TEXT DEFAULT 'new')",
        views: [],
        num_cols: 2,
      };

      const currentColumns: Column[] = [
        {
          type: "column",
          name: "id",
          table: "events",
          data_type: "INTEGER",
          ordinal_position: 1,
          nullable: false,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none",
        },
        {
          type: "column",
          name: "status",
          table: "events",
          data_type: "TEXT",
          ordinal_position: 2,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "'pending'",
          check_constraint: "status IN ('pending','done')",
          autoincrement: false,
          generated: "none",
        },
      ];

      const targetColumns: Column[] = [
        {
          type: "column",
          name: "id",
          table: "events",
          data_type: "INTEGER",
          ordinal_position: 1,
          nullable: false,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none",
        },
        {
          type: "column",
          name: "status",
          table: "events",
          data_type: "TEXT",
          ordinal_position: 2,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "'new'",
          check_constraint: null,
          autoincrement: false,
          generated: "none",
        },
      ];

      const plan: MigrationPlan = [
        {
          type: "recreate",
          current: currentTable,
          target: targetTable,
        },
      ];

      const current = createIntrospection({
        tables: [currentTable],
        columns: currentColumns,
      });

      const desired = createIntrospection({
        tables: [targetTable],
        columns: targetColumns,
      });

      const ddl = generateDDL(plan, current, desired);

      // Check that we're using table recreation
      expect(ddl).toContain(
        "CREATE TABLE \"temp_events\" (id INTEGER PRIMARY KEY, status TEXT DEFAULT 'new');",
      );
      expect(ddl).toContain(
        'INSERT INTO "temp_events" ("id", "status") SELECT "id", "status" FROM "events";',
      );
      expect(ddl).toContain('DROP TABLE "events";');
      expect(ddl).toContain('ALTER TABLE "temp_events" RENAME TO "events";');
    });

    it("should handle multiple operations in correct order", () => {
      // Create a plan with multiple operations
      const plan: MigrationPlan = [
        {
          type: "drop",
          current: {
            type: "view",
            name: "user_view",
            sql: "CREATE VIEW user_view AS SELECT * FROM users",
            tables: ["users"],
          },
        },
        {
          type: "recreate",
          current: {
            type: "table",
            name: "users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
            views: [],
            num_cols: 2,
          },
          target: {
            type: "table",
            name: "users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE)",
            views: [],
            num_cols: 3,
          },
        },
        {
          type: "create",
          target: {
            type: "view",
            name: "user_email_view",
            sql: "CREATE VIEW user_email_view AS SELECT id, email FROM users",
            tables: ["users"],
          },
        },
      ];

      const current = createIntrospection({
        tables: [
          {
            type: "table",
            name: "users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
            views: ["user_view"],
            num_cols: 2,
          },
        ],
        columns: [
          {
            type: "column",
            name: "id",
            table: "users",
            data_type: "INTEGER",
            ordinal_position: 1,
            nullable: false,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none",
          },
          {
            type: "column",
            name: "name",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none",
          },
        ],
        views: [
          {
            type: "view",
            name: "user_view",
            sql: "CREATE VIEW user_view AS SELECT * FROM users",
            tables: ["users"],
          },
        ],
      });

      const desired = createIntrospection({
        tables: [
          {
            type: "table",
            name: "users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE)",
            views: ["user_email_view"],
            num_cols: 3,
          },
        ],
        columns: [
          {
            type: "column",
            name: "id",
            table: "users",
            data_type: "INTEGER",
            ordinal_position: 1,
            nullable: false,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none",
          },
          {
            type: "column",
            name: "name",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none",
          },
          {
            type: "column",
            name: "email",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 3,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none",
          },
        ],
        views: [
          {
            type: "view",
            name: "user_email_view",
            sql: "CREATE VIEW user_email_view AS SELECT id, email FROM users",
            tables: ["users"],
          },
        ],
      });

      const ddl = generateDDL(plan, current, desired);

      // Check operation order: drop view -> recreate table -> create new view
      const dropViewIndex = ddl.findIndex((stmt) =>
        stmt.includes('DROP VIEW IF EXISTS "user_view"'),
      );
      const createTempTableIndex = ddl.findIndex((stmt) =>
        stmt.includes('CREATE TABLE "temp_users"'),
      );
      const createViewIndex = ddl.findIndex((stmt) => stmt.includes("CREATE VIEW user_email_view"));

      expect(dropViewIndex).toBeLessThan(createTempTableIndex);
      expect(createTempTableIndex).toBeLessThan(createViewIndex);
    });
  });

  describe("edge cases", () => {
    it("should handle identifiers with special characters", () => {
      const table: Table = {
        type: "table",
        name: "user data",
        sql: 'CREATE TABLE "user data" (id INTEGER PRIMARY KEY, "full name" TEXT)',
        views: [],
        num_cols: 2,
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: table,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        tables: [table],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('CREATE TABLE "user data" (id INTEGER PRIMARY KEY, "full name" TEXT);');
    });

    it("should handle identifiers with double quotes", () => {
      const column: Column = {
        type: "column",
        name: 'col"with"quotes',
        table: "test_table",
        data_type: "text",
        ordinal_position: 1,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };

      const plan: MigrationPlan = [
        {
          type: "create",
          target: column,
        },
      ];

      const current = createEmptyIntrospection();
      const desired = {
        ...createEmptyIntrospection(),
        columns: [column],
      };

      const ddl = generateDDL(plan, current, desired);

      expect(ddl).toContain('ALTER TABLE "test_table" ADD COLUMN "col""with""quotes" TEXT;');
    });

    it("should handle empty result arrays", () => {
      const invalidTable: Table = {
        type: "table",
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY)",
        views: [],
        num_cols: 1,
      };

      // Define a recreate operation but with empty columns arrays
      const plan: MigrationPlan = [
        {
          type: "recreate",
          current: invalidTable,
          target: invalidTable,
        },
      ];

      const current = {
        ...createEmptyIntrospection(),
        tables: [invalidTable],
      };

      const desired = {
        ...createEmptyIntrospection(),
        tables: [invalidTable],
      };

      const ddl = generateDDL(plan, current, desired);

      // Should create temp table, but no INSERT statement since there are no common columns
      expect(ddl).toContain('CREATE TABLE "temp_users" (id INTEGER PRIMARY KEY);');
      expect(ddl).toContain('DROP TABLE "users";');
      expect(ddl).toContain('ALTER TABLE "temp_users" RENAME TO "users";');
      expect(ddl.every((stmt) => !stmt.includes("INSERT INTO"))).toBe(true);
    });
  });

  describe("virtual table operations", () => {
    // Test-only module with a custom drop and a rebuild
    registerVirtualTableModule<string>({
      name: "ddl_test_module",
      parseArgs: (args) => args.trim(),
      diff: () => [],
      supportsRename: true,
      dependencies: () => [],
      recreate: ({ current, target, currentArgs, targetArgs }) => [
        `-- recreate ${current.name}(${currentArgs}) as ${target.name}(${targetArgs})`,
      ],
      drop: (current, args) => [`-- drop ${current.name}(${args})`],
      rebuild: ({ target, args }) => [`-- rebuild ${target.name}(${args})`],
      warnings: () => [],
    });

    function vtable(name: string, module: string, args: string): VirtualTable {
      return {
        type: "virtual_table",
        name,
        module,
        args,
        sql: `CREATE VIRTUAL TABLE ${name} USING ${module}(${args})`,
      };
    }

    function view(name: string, sqlText: string, tables: string[]): View {
      return { type: "view", name, sql: sqlText, tables };
    }

    const rt = vtable("rt", "rtree", "id, minX, maxX");
    const rt2 = vtable("rt", "rtree", "id, minX, maxX, minY, maxY");

    it("creates a virtual table from its SQL", () => {
      const ddl = generateDDL(
        [{ type: "create", target: rt }],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual(["CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX);"]);
    });

    it("drops a virtual table", () => {
      const ddl = generateDDL(
        [{ type: "drop", current: rt }],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual(['DROP TABLE IF EXISTS "rt";']);
    });

    it("uses the handler's drop when it has one", () => {
      const ddl = generateDDL(
        [{ type: "drop", current: vtable("x", "ddl_test_module", " a ") }],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual(["-- drop x(a)"]);
    });

    it("renames a virtual table", () => {
      const ddl = generateDDL(
        [
          {
            type: "rename",
            current: vtable("old", "ddl_test_module", "a"),
            target: vtable("new", "ddl_test_module", "a"),
          },
        ],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual(['ALTER TABLE "old" RENAME TO "new";']);
    });

    it("recreates with the default handler: DROP + CREATE", () => {
      const ddl = generateDDL(
        [{ type: "recreate", current: rt, target: rt2, reasons: [] }],
        createIntrospection({ virtual_tables: [rt] }),
        createIntrospection({ virtual_tables: [rt2] }),
      );
      expect(ddl).toEqual([
        'DROP TABLE IF EXISTS "rt";',
        "CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX, minY, maxY);",
      ]);
    });

    it("delegates the recreate to the module handler with parsed args", () => {
      const ddl = generateDDL(
        [
          {
            type: "recreate",
            current: vtable("x", "ddl_test_module", " a "),
            target: vtable("x", "ddl_test_module", " b "),
            reasons: [],
          },
        ],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual(["-- recreate x(a) as x(b)"]);
    });

    it("recreates with the current module's drop and the new module's create when the module changes", () => {
      const current = vtable("x", "ddl_test_module", "a");
      const target = vtable("x", "rtree", "id, a, b");
      const ddl = generateDDL(
        [{ type: "recreate", current, target, reasons: [] }],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual(["-- drop x(a)", "CREATE VIRTUAL TABLE x USING rtree(id, a, b);"]);

      // The new module's create: an external-content FTS5 index is rebuilt
      const fts5 = vtable("x", "fts5", "title, content=docs");
      expect(
        generateDDL(
          [
            {
              type: "recreate",
              current: vtable("x", "rtree", "id, a, b"),
              target: fts5,
              reasons: [],
            },
          ],
          createEmptyIntrospection(),
          createEmptyIntrospection(),
        ),
      ).toEqual([
        'DROP TABLE IF EXISTS "x";',
        "CREATE VIRTUAL TABLE x USING fts5(title, content=docs);",
        `INSERT INTO "x"("x") SELECT 'rebuild' WHERE (SELECT count(DISTINCT lower(name)) FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) IN ('title')) = 1 AND (EXISTS (SELECT 1 FROM pragma_table_list('docs') WHERE schema = 'main' AND type IN ('table', 'shadow') AND wr = 0) OR EXISTS (SELECT 1 FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) = 'rowid'));`,
      ]);
    });

    it("drops dependent views before a recreate and restores the desired ones after", () => {
      const currentView = view("rv", "CREATE VIEW rv AS SELECT id FROM rt", ["rt"]);
      const removedView = view("old_rv", "CREATE VIEW old_rv AS SELECT id FROM rt", ["rt"]);
      const desiredView = view("rv", "CREATE VIEW rv AS SELECT id, minX FROM rt", ["rt"]);
      const unrelated = view("other", "CREATE VIEW other AS SELECT 1", []);

      const ddl = generateDDL(
        [{ type: "recreate", current: rt, target: rt2, reasons: [] }],
        createIntrospection({ virtual_tables: [rt], views: [currentView, removedView, unrelated] }),
        createIntrospection({ virtual_tables: [rt2], views: [desiredView, unrelated] }),
      );

      expect(ddl).toEqual([
        'DROP VIEW IF EXISTS "rv";',
        'DROP VIEW IF EXISTS "old_rv";',
        'DROP TABLE IF EXISTS "rt";',
        "CREATE VIRTUAL TABLE rt USING rtree(id, minX, maxX, minY, maxY);",
        "CREATE VIEW rv AS SELECT id, minX FROM rt;",
      ]);
    });

    it("delegates a rebuild to the module handler", () => {
      const ddl = generateDDL(
        [{ type: "rebuild", target: vtable("x", "ddl_test_module", " a "), reasons: [] }],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual(["-- rebuild x(a)"]);
    });

    it("throws for a rebuild of a module that cannot rebuild", () => {
      const generate = () =>
        generateDDL(
          [{ type: "rebuild", target: rt, reasons: [] }],
          createEmptyIntrospection(),
          createEmptyIntrospection(),
        );
      expect(generate).toThrow(`Cannot generate DDL for rebuild of "${rt.name}"`);
      expect(() => generate()).toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({ message: expect.stringMatching(/cannot rebuild/) }),
        }),
      );
    });

    it("uses the handler's create when it has one", () => {
      const ext = vtable("f", "fts5", "title, content=docs");
      const ddl = generateDDL(
        [{ type: "create", target: ext }],
        createEmptyIntrospection(),
        createEmptyIntrospection(),
      );
      expect(ddl).toEqual([
        "CREATE VIRTUAL TABLE f USING fts5(title, content=docs);",
        `INSERT INTO "f"("f") SELECT 'rebuild' WHERE (SELECT count(DISTINCT lower(name)) FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) IN ('title')) = 1 AND (EXISTS (SELECT 1 FROM pragma_table_list('docs') WHERE schema = 'main' AND type IN ('table', 'shadow') AND wr = 0) OR EXISTS (SELECT 1 FROM pragma_table_xinfo('docs', 'main') WHERE hidden <> 1 AND lower(name) = 'rowid'));`,
      ]);
    });

    it("gives the handler's recreate the desired schema", () => {
      // An FTS5 table that used external content copies its rows from the
      // content table only when the desired schema still has it
      const current = vtable("f", "fts5", "title, content=docs");
      const target = vtable("f", "fts5", "title");
      const docs: Table = {
        type: "table",
        name: "docs",
        sql: "CREATE TABLE docs (title TEXT)",
        views: [],
        num_cols: 1,
      };
      const docsTitle: Column = {
        type: "column",
        table: "docs",
        name: "title",
        data_type: "text",
        ordinal_position: 0,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none",
      };
      const plan: MigrationPlan = [{ type: "recreate", current, target, reasons: [] }];
      const copy = `INSERT INTO "f"(rowid, "title") SELECT "rowid", "title" FROM "docs";`;

      const withDocs = createIntrospection({ tables: [docs], columns: [docsTitle] });
      expect(generateDDL(plan, createEmptyIntrospection(), withDocs)).toContain(copy);
      expect(
        generateDDL(plan, createEmptyIntrospection(), createEmptyIntrospection()),
      ).not.toContain(copy);
    });
  });
});
