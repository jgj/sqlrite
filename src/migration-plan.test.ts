import { describe, expect, it } from "vitest";
import type { SchemaDiff } from "./compare/types";
import type { Column } from "./introspection-result";
import { createMigrationPlan } from "./migration-plan";
import { get } from "./test-utils";

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
    current: {
      tables: [],
      columns: [],
      indices: [],
      primary_keys: [],
      foreign_keys: [],
      triggers: [],
      views: [],
    },
    desired: {
      tables: [],
      columns: [],
      indices: [],
      primary_keys: [],
      foreign_keys: [],
      triggers: [],
      views: [],
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
      expect(plan[0].type).toBe("create");
      expect(plan[0].target?.name).toBe("new_table");
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
      expect(plan[0].type).toBe("drop");
      expect(plan[0].current?.name).toBe("old_table");
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
      expect(plan[0].type).toBe("rename");
      expect(plan[0].current?.name).toBe("old_name");
      expect(plan[0].target?.name).toBe("new_name");
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
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0].type).toBe("create");
      expect(plan[0].target?.name).toBe("email");
      expect(get(plan[0], "target.table")).toBe("users");
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
        },
      ];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0].type).toBe("drop");
      expect(plan[0].current?.name).toBe("phone");
      expect(get(plan[0], "current.table")).toBe("users");
    });

    it("should identify column renames", () => {
      const diff = createEmptySchemaDiff();
      const tableObj = {
        type: "table" as const,
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, old_name TEXT, email TEXT)",
        views: [],
        num_cols: 3,
      };
      diff.current.tables.push(tableObj);

      // Define a removed column and an added column with similar properties
      const removedColumn = {
        type: "column" as const,
        name: "old_name",
        table: "users",
        data_type: "TEXT",
        ordinal_position: 2,
        nullable: true,
        character_maximum_length: null,
        precision: null,
        default: "",
        check_constraint: null,
      };

      const addedColumn = {
        ...removedColumn,
        name: "new_name",
      };

      diff.column.removed = [removedColumn];
      diff.column.added = [addedColumn];

      const plan = createMigrationPlan(diff);

      expect(plan).toHaveLength(1);
      expect(plan[0].type).toBe("rename");
      expect(plan[0].current?.name).toBe("old_name");
      expect(plan[0].target?.name).toBe("new_name");
      expect(get(plan[0], "target.table")).toBe("users");
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

    it("should use simple rewrite for foreign key removal", () => {
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

      expect(plan.some((op) => op.type === "rewrite")).toBeTruthy();
      const rewriteOp = plan.find((op) => op.type === "rewrite");
      expect(rewriteOp?.current.name).toBe("orders");
      expect(rewriteOp?.type).toBe("rewrite"); // Not recreate, just rewrite
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
    it("should handle default value changes with a rewrite operation", () => {
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
          },
          changes: ["default"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should use a rewrite operation, not a recreate
      expect(plan.some((op) => op.type === "rewrite")).toBeTruthy();
      expect(plan.every((op) => op.type !== "recreate")).toBeTruthy();

      const rewriteOp = plan.find((op) => op.type === "rewrite");
      expect(rewriteOp?.current.name).toBe("users");
    });

    it("should handle NOT NULL constraint removal with a rewrite operation", () => {
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
          },
          changes: ["nullable"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should use a rewrite operation, not a recreate
      expect(plan.some((op) => op.type === "rewrite")).toBeTruthy();
      expect(plan.every((op) => op.type !== "recreate")).toBeTruthy();

      const rewriteOp = plan.find((op) => op.type === "rewrite");
      expect(rewriteOp?.current.name).toBe("users");
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
      };

      diff.column.removed = [oldColumn];
      diff.column.added = [newColumn];

      const plan = createMigrationPlan(diff);

      // We should have a recreation operation
      const recreateOps = plan.filter((op) => op.type === "recreate");
      expect(recreateOps.length).toBe(1);
      expect(recreateOps[0].current.name).toBe("users");
      expect(recreateOps[0].target.name).toBe("users");

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
        },
      ];

      // Add the column modifications - same columns, different positions
      diff.column.modified = [
        {
          current: originalColumns[1], // name
          desired: reorderedColumns[2], // name with new position
          changes: ["ordinal_position"],
        },
        {
          current: originalColumns[2], // price
          desired: reorderedColumns[3], // price with new position
          changes: ["ordinal_position"],
        },
        {
          current: originalColumns[3], // description
          desired: reorderedColumns[1], // description with new position
          changes: ["ordinal_position"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // The table should be recreated
      const recreateOps = plan.filter((op) => op.type === "recreate");
      expect(recreateOps.length).toBe(1);
      expect(recreateOps[0].current.name).toBe("products");

      // No separate column operations since the table is being recreated
      const columnOps = plan.filter(
        (op) =>
          (op.type === "create" || op.type === "drop" || op.type === "rename") &&
          ((op.target && "table" in op.target) || (op.current && "table" in op.current)),
      );
      expect(columnOps.length).toBe(0);
    });

    it("should use rewrite operation when multiple columns have default value changes", () => {
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
          },
          changes: ["default"],
        },
      ];

      const plan = createMigrationPlan(diff);

      // Should use a rewrite operation, not a recreate
      const rewriteOps = plan.filter((op) => op.type === "rewrite");
      const recreateOps = plan.filter((op) => op.type === "recreate");

      expect(recreateOps.length).toBe(0); // No recreate
      expect(rewriteOps.length).toBe(1); // Just one rewrite
      expect(rewriteOps[0].current.name).toBe("events");
      expect(rewriteOps[0].target.name).toBe("events");

      // No separate column operations
      const columnOps = plan.filter(
        (op) =>
          op.type !== "rewrite" &&
          ((op.target && "table" in op.target) || (op.current && "table" in op.current)),
      );
      expect(columnOps.length).toBe(0);
    });
  });
});
