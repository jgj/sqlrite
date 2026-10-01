import { describe, expect, it } from "vitest";
import type { Modified, SchemaDiff } from "./compare/types";
import type { Column, Table, View, VirtualTable } from "./introspection-result";
import type { MigrationOperation } from "./migration-operation";
import { createMigrationPlan } from "./migration-plan";
import { get } from "./test-utils";
import { registerVirtualTableModule } from "./virtual-tables/registry";
import type { VirtualTableModule } from "./virtual-tables/types";

// Helper function to create minimal schema diff
function createEmptySchemaDiff(): SchemaDiff {
  return {
    table: { added: [], removed: [], modified: [] },
    column: { added: [], removed: [], modified: [] },
    index: { added: [], removed: [], modified: [] },
    foreign_key: { added: [], removed: [], modified: [] },
    primary_key: { added: [], removed: [], modified: [] },
    trigger: { added: [], removed: [], modified: [] },
    view: { added: [], removed: [], modified: [] },
    virtual_table: { added: [], removed: [], modified: [] },
    current: {
      tables: [],
      columns: [],
      indices: [],
      primary_keys: [],
      foreign_keys: [],
      triggers: [],
      views: [],
      virtual_tables: [],
    },
    desired: {
      tables: [],
      columns: [],
      indices: [],
      primary_keys: [],
      foreign_keys: [],
      triggers: [],
      views: [],
      virtual_tables: [],
    },
  };
}

describe("createMigrationPlan", () => {
  describe("Table operations", () => {
    it("should generate table create operations", () => {
      const diff = createEmptySchemaDiff();
      diff.table.added = [
        {
          type: "table",
          name: "new_table",
          sql: "CREATE TABLE new_table (id INTEGER PRIMARY KEY)",
          views: [],
          num_cols: 1,
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe("create");
      expect(plan[0]?.target?.name).toBe("new_table");
    });

    it("should generate table drop operations", () => {
      const diff = createEmptySchemaDiff();
      diff.table.removed = [
        {
          type: "table",
          name: "old_table",
          sql: "CREATE TABLE old_table (id INTEGER PRIMARY KEY)",
          views: [],
          num_cols: 1,
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe("drop");
      expect(plan[0]?.current?.name).toBe("old_table");
    });

    describe("ignoreTableDeletion option", () => {
      it("suppresses table drops when enabled", () => {
        const diff = createEmptySchemaDiff();
        diff.table.removed = [
          {
            type: "table",
            name: "legacy",
            sql: "CREATE TABLE legacy (id INTEGER PRIMARY KEY)",
            views: [],
            num_cols: 1,
          },
        ];

        const plan = createMigrationPlan(diff, { ignoreTableDeletion: true });

        expect(plan).toHaveLength(0);
      });

      it("still emits a rename when a drop+create pair looks like a rename", () => {
        const diff = createEmptySchemaDiff();
        diff.table.added = [
          {
            type: "table",
            name: "new_name",
            sql: "CREATE TABLE new_name (id INTEGER PRIMARY KEY)",
            views: [],
            num_cols: 1,
          },
        ];
        diff.table.removed = [
          {
            type: "table",
            name: "old_name",
            sql: "CREATE TABLE old_name (id INTEGER PRIMARY KEY)",
            views: [],
            num_cols: 1,
          },
        ];

        const plan = createMigrationPlan(diff, { ignoreTableDeletion: true });

        expect(plan).toHaveLength(1);
        expect(plan[0]?.type).toBe("rename");
        expect(plan[0]?.current?.name).toBe("old_name");
        expect(plan[0]?.target?.name).toBe("new_name");
      });

      it("suppresses dependent index drops on ignored tables", () => {
        const diff = createEmptySchemaDiff();
        diff.table.removed = [
          {
            type: "table",
            name: "legacy",
            sql: "CREATE TABLE legacy (id INTEGER PRIMARY KEY, name TEXT)",
            views: [],
            num_cols: 2,
          },
        ];
        diff.index.removed = [
          {
            type: "index",
            name: "legacy_name_idx",
            table: "legacy",
            columns: ["name"],
            unique: false,
            sql: "CREATE INDEX legacy_name_idx ON legacy (name)",
          },
        ];

        const plan = createMigrationPlan(diff, { ignoreTableDeletion: true });

        expect(plan).toHaveLength(0);
      });

      it("suppresses dependent trigger drops on ignored tables", () => {
        const diff = createEmptySchemaDiff();
        diff.table.removed = [
          {
            type: "table",
            name: "legacy",
            sql: "CREATE TABLE legacy (id INTEGER PRIMARY KEY)",
            views: [],
            num_cols: 1,
          },
        ];
        diff.trigger.removed = [
          {
            type: "trigger",
            name: "legacy_trigger",
            table: "legacy",
            sql: "CREATE TRIGGER legacy_trigger AFTER INSERT ON legacy BEGIN SELECT 1; END",
          },
        ];

        const plan = createMigrationPlan(diff, { ignoreTableDeletion: true });

        expect(plan).toHaveLength(0);
      });

      it("suppresses view drops that depend on ignored tables", () => {
        const diff = createEmptySchemaDiff();
        diff.table.removed = [
          {
            type: "table",
            name: "legacy",
            sql: "CREATE TABLE legacy (id INTEGER PRIMARY KEY)",
            views: [],
            num_cols: 1,
          },
        ];
        diff.view.removed = [
          {
            type: "view",
            name: "legacy_view",
            sql: "CREATE VIEW legacy_view AS SELECT * FROM legacy",
            tables: ["legacy"],
          },
        ];

        const plan = createMigrationPlan(diff, { ignoreTableDeletion: true });

        expect(plan).toHaveLength(0);
      });

      it("does not affect drops of tables present in desired (only true deletions)", () => {
        const diff = createEmptySchemaDiff();
        diff.table.added = [
          {
            type: "table",
            name: "added",
            sql: "CREATE TABLE added (id INTEGER PRIMARY KEY)",
            views: [],
            num_cols: 1,
          },
        ];
        diff.table.removed = [
          {
            type: "table",
            name: "legacy",
            sql: "CREATE TABLE legacy (id INTEGER PRIMARY KEY, name TEXT)",
            views: [],
            num_cols: 2,
          },
        ];

        const plan = createMigrationPlan(diff, { ignoreTableDeletion: true });

        expect(plan).toHaveLength(1);
        expect(plan[0]?.type).toBe("create");
        expect(plan[0]?.target?.name).toBe("added");
      });

      it("preserves default behavior when option is unset", () => {
        const diff = createEmptySchemaDiff();
        diff.table.removed = [
          {
            type: "table",
            name: "legacy",
            sql: "CREATE TABLE legacy (id INTEGER PRIMARY KEY)",
            views: [],
            num_cols: 1,
          },
        ];

        const plan = createMigrationPlan(diff);

        expect(plan).toHaveLength(1);
        expect(plan[0]?.type).toBe("drop");
      });
    });

    describe("ignoreColumnOrder option", () => {
      function buildReorderDiff(): SchemaDiff {
        const diff = createEmptySchemaDiff();

        const originalTable = {
          type: "table" as const,
          name: "products",
          sql: "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)",
          views: [],
          num_cols: 3,
        };
        const reorderedTable = {
          type: "table" as const,
          name: "products",
          sql: "CREATE TABLE products (id INTEGER PRIMARY KEY, price REAL, name TEXT)",
          views: [],
          num_cols: 3,
        };

        diff.table.modified = [
          {
            current: originalTable,
            desired: reorderedTable,
            changes: ["sql"],
          },
        ];

        const baseColumn = {
          type: "column" as const,
          table: "products",
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        };

        diff.column.modified = [
          {
            current: {
              ...baseColumn,
              name: "name",
              data_type: "TEXT",
              ordinal_position: 2,
              nullable: true,
            },
            desired: {
              ...baseColumn,
              name: "name",
              data_type: "TEXT",
              ordinal_position: 3,
              nullable: true,
            },
            changes: ["ordinal_position"],
          },
          {
            current: {
              ...baseColumn,
              name: "price",
              data_type: "REAL",
              ordinal_position: 3,
              nullable: true,
            },
            desired: {
              ...baseColumn,
              name: "price",
              data_type: "REAL",
              ordinal_position: 2,
              nullable: true,
            },
            changes: ["ordinal_position"],
          },
        ];

        return diff;
      }

      it("does not recreate the table for a pure column reorder when enabled", () => {
        const diff = buildReorderDiff();

        const plan = createMigrationPlan(diff, { ignoreColumnOrder: true });

        expect(plan).toHaveLength(0);
      });

      it("still recreates by default when option is unset", () => {
        const diff = buildReorderDiff();

        const plan = createMigrationPlan(diff);

        const recreates = plan.filter((op) => op.type === "recreate");
        expect(recreates).toHaveLength(1);
        const checks = (recreates[0]?.reasons ?? []).map((r) => r.check);
        expect(checks).toContain("column.order_changed");
      });

      it("still recreates when reorder coincides with a data_type change", () => {
        const diff = buildReorderDiff();
        // Add a data_type change for "price" alongside its ordinal change.
        const priceModified = diff.column.modified[1] as Modified<Column>;
        diff.column.modified[1] = {
          ...priceModified,
          desired: { ...priceModified.desired, data_type: "NUMERIC" },
          changes: ["ordinal_position", "data_type"],
        };

        const plan = createMigrationPlan(diff, { ignoreColumnOrder: true });

        const recreates = plan.filter((op) => op.type === "recreate");
        expect(recreates).toHaveLength(1);
        const checks = (recreates[0]?.reasons ?? []).map((r) => r.check);
        expect(checks).toContain("column.modified.data_type");
        expect(checks).not.toContain("column.order_changed");
      });

      it("does not interfere with a non-reorder constraint change on a different table", () => {
        const diff = buildReorderDiff();
        const otherTable = {
          type: "table" as const,
          name: "audit",
          sql: "CREATE TABLE audit (id INTEGER PRIMARY KEY)",
          views: [],
          num_cols: 1,
        };
        const otherTableModified = {
          type: "table" as const,
          name: "audit",
          sql: "CREATE TABLE audit (id INTEGER PRIMARY KEY, CHECK (id > 0))",
          views: [],
          num_cols: 1,
        };
        diff.table.modified.push({
          current: otherTable,
          desired: otherTableModified,
          changes: ["sql"],
        });

        const plan = createMigrationPlan(diff, { ignoreColumnOrder: true });

        const recreates = plan.filter((op) => op.type === "recreate");
        expect(recreates).toHaveLength(1);
        expect(recreates[0]?.current.name).toBe("audit");
        const checks = (recreates[0]?.reasons ?? []).map((r) => r.check);
        expect(checks).toContain("table.sql_diff");
      });
    });

    it("should identify table rename operations", () => {
      const diff = createEmptySchemaDiff();
      diff.table.added = [
        {
          type: "table",
          name: "new_name",
          sql: "CREATE TABLE new_name (id INTEGER PRIMARY KEY)",
          views: [],
          num_cols: 1,
        },
      ];
      diff.table.removed = [
        {
          type: "table",
          name: "old_name",
          sql: "CREATE TABLE old_name (id INTEGER PRIMARY KEY)",
          views: [],
          num_cols: 1,
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe("rename");
      expect(plan[0]?.current?.name).toBe("old_name");
      expect(plan[0]?.target?.name).toBe("new_name");
    });

    it("should not identify as renames when table structure differs", () => {
      const diff = createEmptySchemaDiff();
      diff.table.added = [
        {
          type: "table",
          name: "new_name",
          sql: "CREATE TABLE new_name (id INTEGER PRIMARY KEY, name TEXT)",
          views: [],
          num_cols: 2,
        },
      ];
      diff.table.removed = [
        {
          type: "table",
          name: "old_name",
          sql: "CREATE TABLE old_name (id INTEGER PRIMARY KEY)",
          views: [],
          num_cols: 1,
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should have two operations (create and drop) instead of a rename
      expect(plan).toHaveLength(2);
      expect(plan.some((op) => op.type === "create")).toBeTruthy();
      expect(plan.some((op) => op.type === "drop")).toBeTruthy();
    });

    it("should generate recreate operations when table schema changes", () => {
      const diff = createEmptySchemaDiff();
      const originalTable = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY)",
        views: [],
        num_cols: 1,
      };
      const modifiedTable = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: originalTable,
          desired: modifiedTable,
          changes: ["sql"],
        },
      ];

      // Add a column modification that would require table recreation
      diff.column.modified = [
        {
          current: {
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
            generated: "none" as const,
          },
          desired: {
            type: "column",
            name: "id",
            table: "users",
            data_type: "TEXT", // Changed data type
            ordinal_position: 1,
            nullable: false,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          changes: ["data_type"],
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();
      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("users");
      expect(recreateOp?.target.name).toBe("users");
    });
  });

  describe("Column operations", () => {
    it("should generate column add operations", () => {
      const diff = createEmptySchemaDiff();
      diff.column.added = [
        {
          type: "column",
          name: "email",
          table: "users",
          data_type: "TEXT",
          ordinal_position: 2,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe("create");
      expect(plan[0]?.target?.name).toBe("email");
      expect(get(plan[0] ?? {}, "target.table")).toBe("users");
    });

    it("should generate column drop operations", () => {
      const diff = createEmptySchemaDiff();
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)",
        views: [],
        num_cols: 3,
      };
      diff.current.tables.push(tableObj);

      diff.column.removed = [
        {
          type: "column",
          name: "phone",
          table: "users",
          data_type: "TEXT",
          ordinal_position: 3,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe("drop");
      expect(plan[0]?.current?.name).toBe("phone");
      expect(get(plan[0] ?? {}, "current.table")).toBe("users");
    });

    it("does not guess column renames", () => {
      const diff = createEmptySchemaDiff();
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, old_name TEXT)",
        views: [],
        num_cols: 3,
      };
      diff.current.tables.push(tableObj);

      const removedColumn: Column = {
        type: "column",
        name: "old_name",
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
      };
      diff.column.removed = [removedColumn];
      diff.column.added = [{ ...removedColumn, name: "new_name" }];

      const plan = createMigrationPlan(diff);

      expect(plan.map((op) => op.type)).toEqual(["drop", "create"]);
      expect(plan[0]?.current?.name).toBe("old_name");
      expect(plan[1]?.target?.name).toBe("new_name");
    });

    it("renames the columns the renameColumns option declares", () => {
      const diff = createEmptySchemaDiff();
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, old_name TEXT, email TEXT)",
        views: [],
        num_cols: 3,
      };
      diff.current.tables.push(tableObj);
      diff.desired.tables.push({
        ...tableObj,
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, new_name TEXT, email TEXT)",
      });

      // Define a removed column and an added column with similar properties
      const removedColumn = {
        type: "column" as const,
        name: "old_name",
        table: "users",
        data_type: "TEXT",
        ordinal_position: 1,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none" as const,
      };

      const addedColumn = {
        ...removedColumn,
        name: "new_name",
      };

      diff.column.removed = [removedColumn];
      diff.column.added = [addedColumn];

      const plan = createMigrationPlan(diff, {
        renameColumns: { users: { old_name: "new_name" } },
      });

      // The column is in the middle of the table, but a rename keeps it in place
      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe("rename");
      expect(plan[0]?.current?.name).toBe("old_name");
      expect(plan[0]?.target?.name).toBe("new_name");
      expect(get(plan[0] ?? {}, "target.table")).toBe("users");
    });

    it("should include table recreate when nullable column becomes non-nullable", () => {
      const diff = createEmptySchemaDiff();

      // Table definition
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: tableObj,
          desired: tableObj, // Same table object, just to have the table in the diff
          changes: ["sql"],
        },
      ];

      // Column modification that requires table recreation
      diff.column.modified = [
        {
          current: {
            type: "column",
            name: "email",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: true, // Was nullable
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          desired: {
            type: "column",
            name: "email",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: false, // Now not nullable
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          changes: ["nullable"],
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();
      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("users");
    });
  });

  describe("Primary key operations", () => {
    it("should recreate table when primary key changes", () => {
      const diff = createEmptySchemaDiff();

      // Table with changing primary key
      const tableObj = {
        type: "table" as const,
        name: "orders",
        sql: "CREATE TABLE orders (id INTEGER, customer_id INTEGER, PRIMARY KEY(id))",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: tableObj,
          desired: tableObj,
          changes: ["sql"],
        },
      ];

      // Primary key modification
      diff.primary_key.modified = [
        {
          current: {
            type: "primary_key",
            table: "orders",
            column: "id",
            field_count: 1,
            definition: "PRIMARY KEY (id)",
          },
          desired: {
            type: "primary_key",
            table: "orders",
            column: "id,customer_id", // Composite primary key
            field_count: 2,
            definition: "PRIMARY KEY (id, customer_id)",
          },
          changes: ["column", "field_count", "definition"],
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();
      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("orders");
    });
  });

  describe("Foreign key operations", () => {
    it("should recreate table when foreign key is added", () => {
      const diff = createEmptySchemaDiff();

      // Table definition
      const tableObj = {
        type: "table" as const,
        name: "orders",
        sql: "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: tableObj,
          desired: tableObj,
          changes: ["sql"],
        },
      ];

      // Added foreign key
      diff.foreign_key.added = [
        {
          type: "foreign_key",
          name: "fk_orders_customer_id",
          table: "orders",
          column: "customer_id",
          referenced_table: "customers",
          referenced_column: "id",
          on_update: "CASCADE",
          on_delete: "RESTRICT",
          definition:
            "FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT",
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();
      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("orders");
    });

    it("should use simple recreate for foreign key removal", () => {
      const diff = createEmptySchemaDiff();

      // Table with foreign key to be removed
      const currentTable = {
        type: "table" as const,
        name: "orders",
        sql: "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, FOREIGN KEY (customer_id) REFERENCES customers(id))",
        views: [],
        num_cols: 2,
      };

      const desiredTable = {
        type: "table" as const,
        name: "orders",
        sql: "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: currentTable,
          desired: desiredTable,
          changes: ["sql"],
        },
      ];

      // Removed foreign key
      diff.foreign_key.removed = [
        {
          type: "foreign_key",
          name: "fk_orders_customer_id",
          table: "orders",
          column: "customer_id",
          referenced_table: "customers",
          referenced_column: "id",
          on_update: "",
          on_delete: "",
          definition: "FOREIGN KEY (customer_id) REFERENCES customers(id)",
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();
      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("orders");
      expect(recreateOp?.type).toBe("recreate"); // Simple recreate
    });
  });

  describe("Index operations", () => {
    it("should create and drop indexes", () => {
      const diff = createEmptySchemaDiff();

      // Added index
      diff.index.added = [
        {
          type: "index",
          name: "idx_users_email",
          table: "users",
          columns: ["email"],
          unique: false,
          sql: "CREATE INDEX idx_users_email ON users(email)",
        },
      ];

      // Removed index
      diff.index.removed = [
        {
          type: "index",
          name: "idx_users_name",
          table: "users",
          columns: ["name"],
          unique: false,
          sql: "CREATE INDEX idx_users_name ON users(name)",
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should have a create and a drop operation
      expect(plan.filter((op) => op.type === "create")).toHaveLength(1);
      expect(plan.filter((op) => op.type === "drop")).toHaveLength(1);

      const createOp = plan.find((op) => op.type === "create" && op.target.type === "index");
      const dropOp = plan.find((op) => op.type === "drop" && op.current.type === "index");

      expect(createOp?.target?.name).toBe("idx_users_email");
      expect(dropOp?.current?.name).toBe("idx_users_name");
    });

    it("should recreate table when unique index is added", () => {
      const diff = createEmptySchemaDiff();

      // Table definition
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: tableObj,
          desired: tableObj,
          changes: ["sql"],
        },
      ];

      // Added unique index
      diff.index.added = [
        {
          type: "index",
          name: "idx_users_email_unique",
          table: "users",
          columns: ["email"],
          unique: true, // Unique index requires table recreation
          sql: "CREATE UNIQUE INDEX idx_users_email_unique ON users(email)",
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();
      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("users");
    });
  });

  describe("Trigger operations", () => {
    it("should create and drop triggers", () => {
      const diff = createEmptySchemaDiff();

      // Added trigger
      diff.trigger.added = [
        {
          type: "trigger",
          name: "trg_users_after_insert",
          table: "users",
          sql: "CREATE TRIGGER trg_users_after_insert AFTER INSERT ON users BEGIN INSERT INTO audit_log VALUES (new.id, 'insert'); END;",
        },
      ];

      // Removed trigger
      diff.trigger.removed = [
        {
          type: "trigger",
          name: "trg_users_after_update",
          table: "users",
          sql: "CREATE TRIGGER trg_users_after_update AFTER UPDATE ON users BEGIN INSERT INTO audit_log VALUES (new.id, 'update'); END;",
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should have a create and a drop operation
      expect(plan.filter((op) => op.type === "create")).toHaveLength(1);
      expect(plan.filter((op) => op.type === "drop")).toHaveLength(1);

      const createOp = plan.find((op) => op.type === "create" && op.target.type === "trigger");
      const dropOp = plan.find((op) => op.type === "drop" && op.current.type === "trigger");

      expect(createOp?.target?.name).toBe("trg_users_after_insert");
      expect(dropOp?.current?.name).toBe("trg_users_after_update");
    });
  });

  describe("View operations", () => {
    it("should create and drop views", () => {
      const diff = createEmptySchemaDiff();

      // Added view
      diff.view.added = [
        {
          type: "view",
          name: "active_users",
          sql: "CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1",
          tables: ["users"],
        },
      ];

      // Removed view
      diff.view.removed = [
        {
          type: "view",
          name: "user_emails",
          sql: "CREATE VIEW user_emails AS SELECT id, email FROM users",
          tables: ["users"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should have a create and a drop operation
      expect(plan.filter((op) => op.type === "create")).toHaveLength(1);
      expect(plan.filter((op) => op.type === "drop")).toHaveLength(1);

      const createOp = plan.find((op) => op.type === "create" && op.target.type === "view");
      const dropOp = plan.find((op) => op.type === "drop" && op.current.type === "view");

      expect(createOp?.target?.name).toBe("active_users");
      expect(dropOp?.current?.name).toBe("user_emails");
    });
  });

  describe("Complex scenarios", () => {
    it("should handle default value changes with a recreate operation", () => {
      const diff = createEmptySchemaDiff();

      // Table definition
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: tableObj,
          desired: tableObj,
          changes: ["sql"],
        },
      ];

      // Column with default value change
      diff.column.modified = [
        {
          current: {
            type: "column",
            name: "created_at",
            table: "users",
            data_type: "TIMESTAMP",
            ordinal_position: 2,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "CURRENT_TIMESTAMP",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          desired: {
            type: "column",
            name: "created_at",
            table: "users",
            data_type: "TIMESTAMP",
            ordinal_position: 2,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "datetime('now')",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          changes: ["default"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should use a recreate operation
      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();

      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("users");
    });

    it("should handle NOT NULL constraint removal with a recreate operation", () => {
      const diff = createEmptySchemaDiff();

      // Table definition
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [
        {
          current: tableObj,
          desired: tableObj,
          changes: ["sql"],
        },
      ];

      // Column with NOT NULL constraint being removed
      diff.column.modified = [
        {
          current: {
            type: "column",
            name: "email",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: false, // NOT NULL
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          desired: {
            type: "column",
            name: "email",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: true, // Constraint removed
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          changes: ["nullable"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should use a recreate operation
      expect(plan.some((op) => op.type === "recreate")).toBeTruthy();

      const recreateOp = plan.find((op) => op.type === "recreate");
      expect(recreateOp?.current.name).toBe("users");
    });

    it("should handle multiple operations while respecting table recreation precedence", () => {
      const diff = createEmptySchemaDiff();

      // Table that will be recreated
      const usersTable = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)",
        views: [],
        num_cols: 2,
      };

      // Another table with simple operations
      const postsTable = {
        type: "table" as const,
        name: "posts",
        sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)",
        views: [],
        num_cols: 3,
      };

      diff.table.modified = [
        { current: usersTable, desired: usersTable, changes: ["sql"] },
        { current: postsTable, desired: postsTable, changes: ["sql"] },
      ];

      // Data type change requiring recreation
      diff.column.modified = [
        {
          current: {
            type: "column",
            name: "email",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: false,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          desired: {
            type: "column",
            name: "email",
            table: "users",
            data_type: "VARCHAR", // Changed data type
            ordinal_position: 2,
            nullable: false,
            character_maximum_length: 255,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          changes: ["data_type", "character_maximum_length"],
        },
      ];

      // Added column to posts table
      diff.column.added = [
        {
          type: "column",
          name: "content",
          table: "posts",
          data_type: "TEXT",
          ordinal_position: 4,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
      ];

      // Added index to posts table
      diff.index.added = [
        {
          type: "index",
          name: "idx_posts_title",
          table: "posts",
          columns: ["title"],
          unique: false,
          sql: "CREATE INDEX idx_posts_title ON posts(title)",
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should include recreate for users table
      expect(plan.some((op) => op.type === "recreate" && op.current.name === "users")).toBeTruthy();

      // Should include create operations for posts table
      expect(
        plan.some(
          (op) =>
            op.type === "create" &&
            get(op, "target.table") === "posts" &&
            op.target.name === "content",
        ),
      ).toBeTruthy();

      expect(
        plan.some(
          (op) =>
            op.type === "create" &&
            get(op, "target.table") === "posts" &&
            op.target.name === "idx_posts_title",
        ),
      ).toBeTruthy();

      // No recreate for posts table
      expect(
        plan.every((op) => !(op.type === "recreate" && op.current.name === "posts")),
      ).toBeTruthy();
    });

    it("should handle column rename with data type change by recreating the table", () => {
      const diff = createEmptySchemaDiff();

      // Add the users table to both current and desired schema
      const usersTable = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, count INTEGER, new_amount DECIMAL(10,2), created_at TEXT)",
        views: [],
        num_cols: 4,
      };
      diff.desired.tables.push(usersTable);

      const usersTableOld = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, count INTEGER, amount INTEGER, created_at TEXT)",
        views: [],
        num_cols: 4,
      };
      diff.current.tables.push(usersTableOld);

      diff.table.modified = [
        {
          current: usersTableOld,
          desired: usersTable,
          changes: ["sql"],
        },
      ];

      // Create the old column that will be "renamed"
      const oldColumn: Column = {
        type: "column",
        name: "amount",
        table: "users",
        data_type: "INTEGER",
        ordinal_position: 2,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none" as const,
      };

      // Create the new column with a different name AND different data type
      const newColumn: Column = {
        type: "column",
        name: "new_amount",
        table: "users",
        data_type: "DECIMAL", // Changed from INTEGER
        ordinal_position: 2,
        nullable: true,
        character_maximum_length: null,
        precision: { precision: 10, scale: 2 }, // Added precision
        default: "",
        check_constraint: null,
        autoincrement: false,
        generated: "none" as const,
      };

      diff.column.removed = [oldColumn];
      diff.column.added = [newColumn];

      const plan = createMigrationPlan(diff);

      // We should have a recreation operation
      const recreateOps = plan.filter((op) => op.type === "recreate");
      expect(recreateOps.length).toBe(1);
      expect(recreateOps[0]?.current.name).toBe("users");
      expect(recreateOps[0]?.target.name).toBe("users");

      // We should NOT have rename, create, or drop operations for this column
      const renameOps = plan.filter((op) => op.type === "rename");
      const createOps = plan.filter(
        (op) =>
          op.type === "create" && op.target.type === "column" && op.target.name === "new_amount",
      );
      const dropOps = plan.filter(
        (op) => op.type === "drop" && op.current.type === "column" && op.current.name === "amount",
      );

      expect(renameOps.length).toBe(0);
      expect(createOps.length).toBe(0);
      expect(dropOps.length).toBe(0);
    });

    it("should properly handle primary key changes with foreign key dependencies", () => {
      const diff = createEmptySchemaDiff();

      // Define the 'users' table with a changing primary key
      const usersOld = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)",
        views: [],
        num_cols: 1,
      };

      const usersNew = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER, email TEXT, PRIMARY KEY(id, email))",
        views: [],
        num_cols: 1,
      };

      // Define the 'posts' table that references users
      const postsOld = {
        type: "table" as const,
        name: "posts",
        sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(id))",
        views: [],
        num_cols: 1,
      };

      const postsNew = {
        type: "table" as const,
        name: "posts",
        sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, user_email TEXT, FOREIGN KEY(user_id, user_email) REFERENCES users(id, email))",
        views: [],
        num_cols: 1,
      };

      // Add table modifications
      diff.table.modified = [
        { current: usersOld, desired: usersNew, changes: ["sql"] },
        { current: postsOld, desired: postsNew, changes: ["sql"] },
      ];

      // Add primary key change
      diff.primary_key.modified = [
        {
          current: {
            type: "primary_key",
            table: "users",
            column: "id",
            field_count: 1,
            definition: "PRIMARY KEY (id)",
          },
          desired: {
            type: "primary_key",
            table: "users",
            column: "id,email",
            field_count: 2,
            definition: "PRIMARY KEY (id, email)",
          },
          changes: ["column", "field_count", "definition"],
        },
      ];

      // Add foreign key changes
      diff.foreign_key.removed = [
        {
          type: "foreign_key",
          name: "fk_posts_user_id",
          table: "posts",
          column: "user_id",
          referenced_table: "users",
          referenced_column: "id",
          on_update: "",
          on_delete: "",
          definition: "FOREIGN KEY (user_id) REFERENCES users(id)",
        },
      ];

      diff.foreign_key.added = [
        {
          type: "foreign_key",
          name: "fk_posts_user_composite",
          table: "posts",
          column: "user_id,user_email",
          referenced_table: "users",
          referenced_column: "id,email",
          on_update: "",
          on_delete: "",
          definition: "FOREIGN KEY (user_id, user_email) REFERENCES users(id, email)",
        },
      ];

      // Add new column to posts
      diff.column.added = [
        {
          type: "column",
          name: "user_email",
          table: "posts",
          data_type: "TEXT",
          ordinal_position: 3,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
      ];

      const plan = createMigrationPlan(diff);

      // Both tables should be recreated
      const recreateOps = plan.filter((op) => op.type === "recreate");
      expect(recreateOps.length).toBe(2);

      // Check that users and posts are both recreated
      const tableNames = recreateOps.map((op) => op.current.name);
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("posts");

      // The separate foreign key, primary key, and column operations
      // should not exist since their parent tables are being recreated

      // No separate column operations for 'posts.user_email'
      const userEmailColumn = plan.filter(
        (op) =>
          op.type === "create" &&
          op.target?.name === "user_email" &&
          "table" in op.target &&
          op.target.table === "posts",
      );
      expect(userEmailColumn.length).toBe(0);

      // No separate foreign key operations
      const addedForeignKeys = plan.filter(
        (op) =>
          op.type === "create" &&
          "referenced_table" in op.target &&
          op.target.referenced_table === "users",
      );
      const removedForeignKeys = plan.filter(
        (op) =>
          op.type === "drop" &&
          "referenced_table" in op.current &&
          op.current.referenced_table === "users",
      );
      expect(addedForeignKeys.length).toBe(0);
      expect(removedForeignKeys.length).toBe(0);

      // No separate primary key operations
      const primaryKeyOps = plan.filter(
        (op) =>
          (op.type === "create" || op.type === "drop") &&
          ((op.target && "field_count" in op.target) ||
            (op.current && "field_count" in op.current)),
      );
      expect(primaryKeyOps.length).toBe(0);
    });

    it("should recreate table when column order changes", () => {
      const diff = createEmptySchemaDiff();

      // Define table with original column order
      const originalTable = {
        type: "table" as const,
        name: "products",
        sql: "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, description TEXT)",
        views: [],
        num_cols: 1,
      };

      // Same table with different column order
      const reorderedTable = {
        type: "table" as const,
        name: "products",
        sql: "CREATE TABLE products (id INTEGER PRIMARY KEY, description TEXT, name TEXT, price REAL)",
        views: [],
        num_cols: 1,
      };

      diff.table.modified = [
        {
          current: originalTable,
          desired: reorderedTable,
          changes: ["sql"],
        },
      ];

      // Define columns with changed ordinal positions
      const originalColumns = [
        {
          type: "column" as const,
          name: "id",
          table: "products",
          data_type: "INTEGER",
          ordinal_position: 1,
          nullable: false,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
        {
          type: "column" as const,
          name: "name",
          table: "products",
          data_type: "TEXT",
          ordinal_position: 2,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
        {
          type: "column" as const,
          name: "price",
          table: "products",
          data_type: "REAL",
          ordinal_position: 3,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
        {
          type: "column" as const,
          name: "description",
          table: "products",
          data_type: "TEXT",
          ordinal_position: 4,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
      ];

      const reorderedColumns = [
        {
          type: "column" as const,
          name: "id",
          table: "products",
          data_type: "INTEGER",
          ordinal_position: 1,
          nullable: false,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
        {
          type: "column" as const,
          name: "description", // moved from position 4 to 2
          table: "products",
          data_type: "TEXT",
          ordinal_position: 2,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
        {
          type: "column" as const,
          name: "name", // moved from position 2 to 3
          table: "products",
          data_type: "TEXT",
          ordinal_position: 3,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
        {
          type: "column" as const,
          name: "price", // moved from position 3 to 4
          table: "products",
          data_type: "REAL",
          ordinal_position: 4,
          nullable: true,
          character_maximum_length: null,
          precision: null,
          default: "",
          check_constraint: null,
          autoincrement: false,
          generated: "none" as const,
        },
      ];

      // Add the column modifications - same columns, different positions
      diff.column.modified = [
        {
          current: originalColumns[1] as Column, // name
          desired: reorderedColumns[2] as Column, // name with new position
          changes: ["ordinal_position"],
        },
        {
          current: originalColumns[2] as Column, // price
          desired: reorderedColumns[3] as Column, // price with new position
          changes: ["ordinal_position"],
        },
        {
          current: originalColumns[3] as Column, // description
          desired: reorderedColumns[1] as Column, // description with new position
          changes: ["ordinal_position"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // The table should be recreated
      const recreateOps = plan.filter((op) => op.type === "recreate");
      expect(recreateOps.length).toBe(1);
      expect(recreateOps[0]?.current.name).toBe("products");

      // The reason for recreation should explicitly call out the column order change
      expect(recreateOps[0]?.reasons).toBeDefined();
      const checks = (recreateOps[0]?.reasons ?? []).map((r) => r.check);
      expect(checks).toContain("column.order_changed");

      // No separate column operations since the table is being recreated
      const columnOps = plan.filter(
        (op) =>
          (op.type === "create" || op.type === "drop" || op.type === "rename") &&
          ((op.target && "table" in op.target) || (op.current && "table" in op.current)),
      );
      expect(columnOps.length).toBe(0);
    });

    it("should use recreate operation when multiple columns have default value changes", () => {
      const diff = createEmptySchemaDiff();

      // Define table with original default values
      const originalTable = {
        type: "table" as const,
        name: "events",
        sql: "CREATE TABLE events (id INTEGER PRIMARY KEY, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        views: [],
        num_cols: 1,
      };

      // Same table but with changed default values
      const modifiedTable = {
        type: "table" as const,
        name: "events",
        sql: "CREATE TABLE events (id INTEGER PRIMARY KEY, status TEXT DEFAULT 'new', created_at TIMESTAMP DEFAULT datetime('now'))",
        views: [],
        num_cols: 1,
      };

      diff.table.modified = [
        {
          current: originalTable,
          desired: modifiedTable,
          changes: ["sql"],
        },
      ];

      // Define columns with changed default values
      diff.column.modified = [
        {
          current: {
            type: "column",
            name: "status",
            table: "events",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "'pending'",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          desired: {
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
            generated: "none" as const,
          },
          changes: ["default"],
        },
        {
          current: {
            type: "column",
            name: "created_at",
            table: "events",
            data_type: "TIMESTAMP",
            ordinal_position: 3,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "CURRENT_TIMESTAMP",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          desired: {
            type: "column",
            name: "created_at",
            table: "events",
            data_type: "TIMESTAMP",
            ordinal_position: 3,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "datetime('now')",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          changes: ["default"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should use a recreate operation
      const recreateOps = plan.filter((op) => op.type === "recreate");

      expect(recreateOps.length).toBe(1); // Just one recreate
      expect(recreateOps[0]?.current.name).toBe("events");
      expect(recreateOps[0]?.target.name).toBe("events");

      // No separate column operations
      const columnOps = plan.filter(
        (op) =>
          op.type !== "recreate" &&
          ((op.target && "table" in op.target) || (op.current && "table" in op.current)),
      );
      expect(columnOps.length).toBe(0);
    });
  });

  describe("Recreate reasons", () => {
    it("populates reasons for a data type change with before/after values", () => {
      const diff = createEmptySchemaDiff();
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, age INTEGER)",
        views: [],
        num_cols: 2,
      };

      diff.table.modified = [{ current: tableObj, desired: tableObj, changes: ["sql"] }];
      diff.column.modified = [
        {
          current: {
            type: "column",
            name: "age",
            table: "users",
            data_type: "INTEGER",
            ordinal_position: 2,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          desired: {
            type: "column",
            name: "age",
            table: "users",
            data_type: "TEXT",
            ordinal_position: 2,
            nullable: true,
            character_maximum_length: null,
            precision: null,
            default: "",
            check_constraint: null,
            autoincrement: false,
            generated: "none" as const,
          },
          changes: ["data_type"],
        },
      ];

      const plan = createMigrationPlan(diff);
      const recreate = plan.find((op) => op.type === "recreate");

      expect(recreate?.reasons).toEqual([
        expect.objectContaining({
          check: "column.modified.data_type",
          detail: expect.stringContaining("INTEGER"),
        }),
      ]);
      expect(recreate?.reasons?.[0]?.detail).toContain("TEXT");
    });

    it("populates a table.sql_diff reason with both SQL strings when no structural change explains it", () => {
      const diff = createEmptySchemaDiff();
      const current = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, CHECK (id > 0))",
        views: [],
        num_cols: 1,
      };
      const desired = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, CHECK (id >= 0))",
        views: [],
        num_cols: 1,
      };

      diff.table.modified = [{ current, desired, changes: ["sql"] }];

      const plan = createMigrationPlan(diff);
      const recreate = plan.find((op) => op.type === "recreate");

      expect(recreate?.reasons?.map((r) => r.check)).toContain("table.sql_diff");
      const sqlDiffReason = recreate?.reasons?.find((r) => r.check === "table.sql_diff");
      expect(sqlDiffReason?.detail).toContain("CHECK (id > 0)");
      expect(sqlDiffReason?.detail).toContain("CHECK (id >= 0)");
    });
  });

  describe("Virtual table operations", () => {
    // Test-only modules. "plan_test_dep(<table>)" reads from <table>: it asks
    // for a rebuild when <table> is recreated and a recreate when it is
    // renamed. "plan_test_norebuild" asks for a rebuild but cannot do one.
    // "plan_test_renamable" supports ALTER TABLE ... RENAME.
    const depModule: VirtualTableModule<string> = {
      name: "plan_test_dep",
      parseArgs: (args) => args.trim(),
      diff: (a, b) => (a === b ? [] : [{ check: "dep.args", detail: `${a} → ${b}` }]),
      supportsRename: true,
      dependencies: (_vt, args) => [args],
      recreate: () => [],
      rebuild: () => [],
      onDependencyChanged: ({ change }) => (change === "recreated" ? "rebuild" : "recreate"),
      warnings: () => [],
    };
    registerVirtualTableModule(depModule);
    registerVirtualTableModule({
      ...depModule,
      name: "plan_test_norebuild",
      rebuild: undefined,
      onDependencyChanged: () => "rebuild",
    });
    registerVirtualTableModule({
      ...depModule,
      name: "plan_test_renamable",
      dependencies: () => [],
      onDependencyChanged: undefined,
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

    function table(name: string, sql: string): Table {
      return { type: "table", name, sql, views: [], num_cols: 1 };
    }

    // A modified table whose CHECK constraint changed, which forces a recreate
    function recreatedTable(diff: SchemaDiff, name: string) {
      diff.table.modified.push({
        current: table(name, `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, CHECK (id > 0))`),
        desired: table(name, `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, CHECK (id >= 0))`),
        changes: ["sql"],
      });
    }

    function view(name: string, tables: string[]): View {
      return { type: "view", name, sql: `CREATE VIEW ${name} AS SELECT 1`, tables };
    }

    const rt = vtable("rt", "rtree", "id, minX, maxX");
    const rt2 = vtable("rt", "rtree", "id, minX, maxX, minY, maxY");

    describe("with manageVirtualTables off", () => {
      it("emits no virtual table operations for any virtual table difference", () => {
        const diff = createEmptySchemaDiff();
        diff.virtual_table.added = [vtable("added", "rtree", "id, a, b")];
        diff.virtual_table.removed = [vtable("removed", "rtree", "id, a, b")];
        diff.virtual_table.modified = [{ current: rt, desired: rt2, changes: ["args"] }];

        expect(createMigrationPlan(diff)).toEqual([]);
        expect(createMigrationPlan(diff, { ignoreTableDeletion: true })).toEqual([]);
      });

      it("ignores a view whose only difference is the virtual tables it resolves to", () => {
        const diff = createEmptySchemaDiff();
        // The desired schema declares the view but not the virtual table it reads
        diff.current.virtual_tables = [rt];
        diff.view.modified = [
          { current: view("rv", ["rt"]), desired: view("rv", []), changes: ["tables"] },
        ];

        expect(createMigrationPlan(diff)).toEqual([]);
      });

      it("still recreates a view whose base tables or SQL changed", () => {
        const diff = createEmptySchemaDiff();
        diff.current.virtual_tables = [rt];
        diff.view.modified = [
          { current: view("a", ["rt", "t"]), desired: view("a", []), changes: ["tables"] },
          { current: view("b", ["rt"]), desired: view("b", []), changes: ["sql", "tables"] },
        ];

        expect(
          createMigrationPlan(diff).map((op) => `${op.type}:${(op.target ?? op.current)?.name}`),
        ).toEqual(["drop:a", "drop:b", "create:a", "create:b"]);
      });

      it("does not react to dependency changes", () => {
        const diff = createEmptySchemaDiff();
        const dep = vtable("dep", "plan_test_dep", "docs");
        diff.current.virtual_tables = [dep];
        diff.desired.virtual_tables = [dep];
        recreatedTable(diff, "docs");

        const plan = createMigrationPlan(diff);
        expect(plan.map((op) => op.type)).toEqual(["recreate"]);
        expect(plan[0]?.current?.type).toBe("table");
      });
    });

    describe("with manageVirtualTables on", () => {
      const options = { manageVirtualTables: true };

      it("creates added virtual tables", () => {
        const diff = createEmptySchemaDiff();
        diff.virtual_table.added = [rt];

        expect(createMigrationPlan(diff, options)).toEqual([{ type: "create", target: rt }]);
      });

      it("drops removed virtual tables", () => {
        const diff = createEmptySchemaDiff();
        diff.virtual_table.removed = [rt];

        expect(createMigrationPlan(diff, options)).toEqual([{ type: "drop", current: rt }]);
      });

      it("recreates modified virtual tables with the handler's reasons", () => {
        const diff = createEmptySchemaDiff();
        diff.virtual_table.modified = [{ current: rt, desired: rt2, changes: ["args"] }];

        expect(createMigrationPlan(diff, options)).toEqual([
          {
            type: "recreate",
            current: rt,
            target: rt2,
            reasons: [
              {
                check: "virtual_table.args",
                detail: "Module arguments changed: (id, minX, maxX) → (id, minX, maxX, minY, maxY)",
              },
            ],
          },
        ]);
      });

      it("uses DROP + CREATE for a name change when the module does not support rename", () => {
        const diff = createEmptySchemaDiff();
        const renamed = vtable("rt_new", "rtree", "id, minX, maxX");
        diff.virtual_table.removed = [rt];
        diff.virtual_table.added = [renamed];

        const plan = createMigrationPlan(diff, options);
        expect(plan).toEqual([
          { type: "drop", current: rt },
          { type: "create", target: renamed },
        ]);
      });

      it("renames when the module supports it and the definitions are equivalent", () => {
        const diff = createEmptySchemaDiff();
        const before = vtable("before", "plan_test_renamable", "x");
        const after = vtable("after", "PLAN_TEST_RENAMABLE", "  x ");
        diff.virtual_table.removed = [before];
        diff.virtual_table.added = [after];

        expect(createMigrationPlan(diff, options)).toEqual([
          { type: "rename", current: before, target: after },
        ]);
      });

      it("does not rename when the definitions differ", () => {
        const diff = createEmptySchemaDiff();
        const before = vtable("before", "plan_test_renamable", "x");
        const after = vtable("after", "plan_test_renamable", "y");
        diff.virtual_table.removed = [before];
        diff.virtual_table.added = [after];

        expect(createMigrationPlan(diff, options).map((op) => op.type)).toEqual(["drop", "create"]);
      });

      it("renames an FTS5 table whose definition is only cosmetically different", () => {
        const diff = createEmptySchemaDiff();
        const before = vtable("notes", "fts5", "title, body, tokenize=porter");
        const after = vtable("notes2", "FTS5", `"title", [body], TOKENIZE='porter unicode61'`);
        diff.virtual_table.removed = [before];
        diff.virtual_table.added = [after];

        expect(createMigrationPlan(diff, options)).toEqual([
          { type: "rename", current: before, target: after },
        ]);
      });

      it("does not rename a virtual table its handler says cannot be renamed", () => {
        // ALTER TABLE ... RENAME leaves an FTS5 contentless_unindexed table's
        // %_content shadow table behind
        const diff = createEmptySchemaDiff();
        const args = "a, b UNINDEXED, content='', contentless_unindexed=1";
        const before = vtable("before", "fts5", args);
        const after = vtable("after", "fts5", args);
        diff.virtual_table.removed = [before];
        diff.virtual_table.added = [after];

        expect(createMigrationPlan(diff, options)).toEqual([
          { type: "drop", current: before },
          { type: "create", target: after },
        ]);
      });

      it("pairs each removed virtual table with at most one rename target", () => {
        const diff = createEmptySchemaDiff();
        const a = vtable("a", "plan_test_renamable", "x");
        const b = vtable("b", "plan_test_renamable", "x");
        const c = vtable("c", "plan_test_renamable", "x");
        diff.virtual_table.removed = [a];
        diff.virtual_table.added = [b, c];

        expect(createMigrationPlan(diff, options)).toEqual([
          { type: "rename", current: a, target: b },
          { type: "create", target: c },
        ]);
      });

      it("orders virtual table drops before table changes and creates after column changes", () => {
        const diff = createEmptySchemaDiff();
        recreatedTable(diff, "docs");
        diff.index.removed = [
          {
            type: "index",
            name: "old_idx",
            table: "other",
            columns: ["a"],
            unique: false,
            sql: null,
          },
        ];
        diff.index.added = [
          {
            type: "index",
            name: "new_idx",
            table: "other",
            columns: ["b"],
            unique: false,
            sql: null,
          },
        ];
        diff.trigger.added = [
          { type: "trigger", name: "trg", table: "other", sql: "CREATE TRIGGER trg ..." },
        ];
        diff.view.added = [view("v_new", ["other"])];
        diff.virtual_table.removed = [vtable("gone", "rtree", "id, a, b")];
        diff.virtual_table.added = [vtable("fresh", "rtree", "id, a, b")];
        diff.virtual_table.modified = [{ current: rt, desired: rt2, changes: ["args"] }];

        const plan = createMigrationPlan(diff, options);
        const describe = (op: MigrationOperation) =>
          `${op.type}:${(op.current ?? op.target)?.type}:${(op.target ?? op.current)?.name}`;

        expect(plan.map(describe)).toEqual([
          "drop:index:old_idx",
          "drop:virtual_table:gone",
          "recreate:table:docs",
          "create:virtual_table:fresh",
          "recreate:virtual_table:rt",
          "create:index:new_idx",
          "create:trigger:trg",
          "create:view:v_new",
        ]);
      });

      it("recreates a view whose virtual table is dropped", () => {
        const diff = createEmptySchemaDiff();
        diff.current.virtual_tables = [rt];
        diff.virtual_table.removed = [rt];
        diff.view.modified = [
          { current: view("rv", ["rt"]), desired: view("rv", []), changes: ["tables"] },
        ];

        expect(
          createMigrationPlan(diff, options).map(
            (op) => `${op.type}:${(op.target ?? op.current)?.name}`,
          ),
        ).toEqual(["drop:rv", "drop:rt", "create:rv"]);
      });

      it("leaves views that depend on a recreated virtual table to the recreate", () => {
        const diff = createEmptySchemaDiff();
        diff.virtual_table.modified = [{ current: rt, desired: rt2, changes: ["args"] }];
        diff.view.modified = [
          { current: view("rv", ["rt"]), desired: view("rv", ["rt"]), changes: ["sql"] },
        ];

        const plan = createMigrationPlan(diff, options);
        expect(plan.map((op) => op.type)).toEqual(["recreate"]);
      });

      describe("ignoreTableDeletion", () => {
        it("keeps virtual tables missing from the desired schema", () => {
          const diff = createEmptySchemaDiff();
          diff.virtual_table.removed = [rt];

          expect(createMigrationPlan(diff, { ...options, ignoreTableDeletion: true })).toEqual([]);
        });

        it("keeps the views that depend on them", () => {
          const diff = createEmptySchemaDiff();
          diff.virtual_table.removed = [rt];
          diff.view.removed = [view("rv", ["rt"])];

          expect(createMigrationPlan(diff, { ...options, ignoreTableDeletion: true })).toEqual([]);
        });

        it("still renames when a drop+create pair resolves to a rename", () => {
          const diff = createEmptySchemaDiff();
          const before = vtable("before", "plan_test_renamable", "x");
          const after = vtable("after", "plan_test_renamable", "x");
          diff.virtual_table.removed = [before];
          diff.virtual_table.added = [after];

          expect(createMigrationPlan(diff, { ...options, ignoreTableDeletion: true })).toEqual([
            { type: "rename", current: before, target: after },
          ]);
        });
      });

      describe("dependency reactions", () => {
        it("rebuilds a virtual table after the table it reads from is recreated", () => {
          const diff = createEmptySchemaDiff();
          const dep = vtable("dep", "plan_test_dep", "docs");
          diff.current.virtual_tables = [dep];
          diff.desired.virtual_tables = [dep];
          recreatedTable(diff, "docs");

          const plan = createMigrationPlan(diff, options);
          expect(plan.map((op) => op.type)).toEqual(["recreate", "rebuild"]);
          expect(plan[1]).toEqual({
            type: "rebuild",
            target: dep,
            reasons: [
              {
                check: "virtual_table.dependency_recreated",
                detail: 'Table "docs" read by virtual table "dep" is recreated',
              },
            ],
          });
        });

        it("matches dependency names case-insensitively", () => {
          const diff = createEmptySchemaDiff();
          const dep = vtable("dep", "plan_test_dep", "DOCS");
          diff.current.virtual_tables = [dep];
          diff.desired.virtual_tables = [dep];
          recreatedTable(diff, "docs");

          expect(createMigrationPlan(diff, options).map((op) => op.type)).toEqual([
            "recreate",
            "rebuild",
          ]);
        });

        it("recreates a virtual table after the table it reads from is renamed", () => {
          const diff = createEmptySchemaDiff();
          const current = vtable("dep", "plan_test_dep", "docs");
          const target = vtable("dep", "plan_test_dep", "docs");
          diff.current.virtual_tables = [current];
          diff.desired.virtual_tables = [target];
          diff.table.removed = [table("docs", "CREATE TABLE docs (id INTEGER PRIMARY KEY)")];
          diff.table.added = [
            table("documents", "CREATE TABLE documents (id INTEGER PRIMARY KEY)"),
          ];

          const plan = createMigrationPlan(diff, options);
          expect(plan.map((op) => op.type)).toEqual(["rename", "recreate"]);
          expect(plan[1]).toEqual({
            type: "recreate",
            current,
            target,
            reasons: [expect.objectContaining({ check: "virtual_table.dependency_renamed" })],
          });
        });

        it("does not also rebuild a virtual table that is already recreated or created", () => {
          const diff = createEmptySchemaDiff();
          const current = vtable("dep", "plan_test_dep", "docs");
          const target = vtable("dep", "plan_test_dep", "other");
          const fresh = vtable("fresh", "plan_test_dep", "docs");
          diff.current.virtual_tables = [current];
          diff.desired.virtual_tables = [target, fresh];
          diff.virtual_table.modified = [{ current, desired: target, changes: ["args"] }];
          diff.virtual_table.added = [fresh];
          recreatedTable(diff, "docs");
          recreatedTable(diff, "other");

          const plan = createMigrationPlan(diff, options);
          expect(plan.filter((op) => op.type === "rebuild")).toEqual([]);
          expect(plan.filter((op) => op.current?.type === "virtual_table")).toHaveLength(1);
        });

        it("falls back to a recreate when the handler cannot rebuild", () => {
          const diff = createEmptySchemaDiff();
          const dep = vtable("dep", "plan_test_norebuild", "docs");
          diff.current.virtual_tables = [dep];
          diff.desired.virtual_tables = [dep];
          recreatedTable(diff, "docs");

          const plan = createMigrationPlan(diff, options);
          expect(plan.map((op) => op.type)).toEqual(["recreate", "recreate"]);
          expect(plan[1]?.current?.type).toBe("virtual_table");
        });

        it("turns a pending rename into a recreate from the old name", () => {
          const diff = createEmptySchemaDiff();
          const before = vtable("before", "plan_test_dep", "docs");
          const after = vtable("after", "plan_test_dep", "docs");
          diff.current.virtual_tables = [before];
          diff.desired.virtual_tables = [after];
          diff.virtual_table.removed = [before];
          diff.virtual_table.added = [after];
          diff.table.removed = [table("docs", "CREATE TABLE docs (id INTEGER PRIMARY KEY)")];
          diff.table.added = [table("docs2", "CREATE TABLE docs2 (id INTEGER PRIMARY KEY)")];

          const plan = createMigrationPlan(diff, options);
          expect(plan.filter((op) => op.current?.type === "virtual_table")).toEqual([
            {
              type: "recreate",
              current: before,
              target: after,
              reasons: [expect.objectContaining({ check: "virtual_table.dependency_renamed" })],
            },
          ]);
        });

        it("ignores virtual tables whose dependencies are unchanged", () => {
          const diff = createEmptySchemaDiff();
          const dep = vtable("dep", "plan_test_dep", "docs");
          diff.current.virtual_tables = [dep];
          diff.desired.virtual_tables = [dep];
          recreatedTable(diff, "unrelated");

          expect(createMigrationPlan(diff, options).map((op) => op.type)).toEqual(["recreate"]);
        });
      });

      // The rows are read through the content view before anything changes
      it("splits an FTS5 recreate that reads its rows through its content view", () => {
        const diff = createEmptySchemaDiff();
        const current = vtable("docs", "fts5", "title, content=recent, content_rowid=id");
        const desired = vtable("docs", "fts5", "title");
        diff.current.virtual_tables = [current];
        diff.desired.virtual_tables = [desired];
        diff.desired.views = [view("recent", ["src"])];
        diff.virtual_table.modified = [{ current, desired, changes: ["args"] }];
        recreatedTable(diff, "src");

        const plan = createMigrationPlan(diff, options);
        expect(plan.map((op) => `${op.type}:${(op.target ?? op.current)?.name}`)).toEqual([
          "recreate:docs",
          "recreate:src",
          "recreate:docs",
        ]);
        expect(plan[0]).toMatchObject({ step: "drop", current, target: desired });
        expect(plan[2]).toMatchObject({ step: "create", current, target: desired });
      });

      describe("renames the shadow tables of a virtual table along with it", () => {
        const fts = (name: string) => vtable(name, "fts5", "body");
        const names = (plan: MigrationOperation[]) =>
          plan.map((op) => `${op.type}:${op.current?.name}->${op.target?.name}`);

        it("dropping a table that holds one of the new names first", () => {
          const diff = createEmptySchemaDiff();
          diff.virtual_table.removed = [fts("a")];
          diff.virtual_table.added = [fts("b")];
          diff.table.removed = [table("b_data", "CREATE TABLE b_data (x)")];

          expect(names(createMigrationPlan(diff, options))).toEqual([
            "drop:b_data->undefined",
            "rename:a->b",
          ]);
        });

        it("renaming a table into one of the current names after it", () => {
          const diff = createEmptySchemaDiff();
          diff.virtual_table.removed = [fts("a")];
          diff.virtual_table.added = [fts("b")];
          diff.table.removed = [table("a_meta", "CREATE TABLE a_meta (k, v)")];
          diff.table.added = [table("a_config", "CREATE TABLE a_config (k, v)")];

          expect(names(createMigrationPlan(diff, options))).toEqual([
            "rename:a->b",
            "rename:a_meta->a_config",
          ]);
        });

        it.each([
          ["a", "a_data"],
          ["a_data", "a"],
        ])("through a temporary name when %s becomes %s", (from, to) => {
          const diff = createEmptySchemaDiff();
          diff.virtual_table.removed = [fts(from)];
          diff.virtual_table.added = [fts(to)];

          expect(names(createMigrationPlan(diff, options))).toEqual([
            `rename:${from}->sqlrite_rename_${to}`,
            `rename:sqlrite_rename_${to}->${to}`,
          ]);
        });
      });
    });
  });
});
