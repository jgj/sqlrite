import { beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "./driver";
import type { Driver } from "./driver";
import { introspect } from "./introspect";
import { type SQLite, getBetterSqlite3Database, getLibsqlClient } from "./sqlite";

describe("introspect", () => {
  // Basic unit test with a mock driver
  describe("unit tests", () => {
    it("should parse introspection results correctly", async () => {
      // Mock minimal schema result
      const mockDriver = {
        query: async () => [
          {
            schema: JSON.stringify({
              tables: [
                {
                  type: "table",
                  name: "test_table",
                  sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
                  views: [],
                  num_cols: 1,
                },
              ],
              columns: [
                {
                  type: "column",
                  table: "test_table",
                  name: "id",
                  data_type: "integer",
                  ordinal_position: 0,
                  nullable: "false",
                  character_maximum_length: "null",
                  precision: "null",
                  default: "",
                  check_constraint: null,
                },
              ],
              indices: [],
              foreign_keys: [],
              primary_keys: [
                {
                  type: "primary_key",
                  table: "test_table",
                  column: "id",
                  field_count: 1,
                  definition: "PRIMARY KEY (id)",
                },
              ],
              triggers: [],
              views: [],
            }),
          },
        ],
        execute: async () => {},
        migrate: async () => true,
      };

      const result = await introspect(mockDriver as unknown as Driver);

      expect(result).toHaveProperty("tables");
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].name).toBe("test_table");
      expect(result.columns).toHaveLength(1);
      expect(result.columns[0].name).toBe("id");
      expect(result.primary_keys).toHaveLength(1);
      expect(result.primary_keys[0].column).toBe("id");
    });

    it("should handle empty schema", async () => {
      const mockDriver = {
        query: async () => [
          {
            schema: JSON.stringify({
              tables: [],
              columns: [],
              indices: [],
              foreign_keys: [],
              primary_keys: [],
              triggers: [],
              views: [],
            }),
          },
        ],
        execute: async () => {},
        migrate: async () => true,
      };

      const result = await introspect(mockDriver as unknown as Driver);

      expect(result).toHaveProperty("tables");
      expect(result.tables).toHaveLength(0);
      expect(result.columns).toHaveLength(0);
      expect(result.indices).toHaveLength(0);
      expect(result.foreign_keys).toHaveLength(0);
      expect(result.primary_keys).toHaveLength(0);
      expect(result.triggers).toHaveLength(0);
    });
  });

  // Integration tests with actual SQLite clients
  describe.each([
    { name: "libsql", getClient: getLibsqlClient },
    { name: "better-sqlite3", getClient: getBetterSqlite3Database },
  ])("integration with $name", ({ getClient }) => {
    let client: SQLite;
    let driver: ReturnType<typeof getDriver>;

    // Helper function to execute multiple SQL statements
    async function executeStatements(sql: string): Promise<void> {
      await driver.execute(sql);
    }

    beforeEach(async () => {
      client = await getClient();
      driver = getDriver(client);

      // Clear all existing schema objects for test isolation
      await driver.execute("PRAGMA foreign_keys = OFF;");

      // Get list of all tables
      const tables = await driver.query<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      );

      // Drop all tables
      for (const table of tables) {
        await driver.execute(`DROP TABLE IF EXISTS "${table.name}";`);
      }

      // Get list of all triggers
      const triggers = await driver.query<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type = 'trigger'",
      );

      // Drop all triggers
      for (const trigger of triggers) {
        await driver.execute(`DROP TRIGGER IF EXISTS "${trigger.name}";`);
      }

      await driver.execute("PRAGMA foreign_keys = ON;");
    });

    it("should introspect an empty database", async () => {
      const result = await introspect(driver);

      expect(result).toBeDefined();
      expect(result.tables).toHaveLength(0);
      expect(result.columns).toHaveLength(0);
      expect(result.indices).toHaveLength(0);
      expect(result.foreign_keys).toHaveLength(0);
      expect(result.primary_keys).toHaveLength(0);
      expect(result.triggers).toHaveLength(0);
    });

    it("should introspect a simple table", async () => {
      await executeStatements(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          age INTEGER DEFAULT 18
        );
      `);

      const result = await introspect(driver);

      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].name).toBe("users");

      expect(result.columns).toHaveLength(4);

      const idColumn = result.columns.find((c) => c.name === "id");
      expect(idColumn).toBeDefined();
      expect(idColumn?.data_type).toBe("integer");
      expect(idColumn?.nullable).toBe(false);

      const nameColumn = result.columns.find((c) => c.name === "name");
      expect(nameColumn).toBeDefined();
      expect(nameColumn?.data_type).toBe("text");
      expect(nameColumn?.nullable).toBe(false);

      const emailColumn = result.columns.find((c) => c.name === "email");
      expect(emailColumn).toBeDefined();
      expect(emailColumn?.data_type).toBe("text");
      expect(emailColumn?.nullable).toBe(true);

      const ageColumn = result.columns.find((c) => c.name === "age");
      expect(ageColumn).toBeDefined();
      expect(ageColumn?.data_type).toBe("integer");
      expect(ageColumn?.default).toBe("18");

      expect(result.primary_keys).toHaveLength(1);
      expect(result.primary_keys[0].table).toBe("users");
      expect(result.primary_keys[0].column).toBe("id");
    });

    it("should introspect tables with foreign keys", async () => {
      await executeStatements(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
        
        CREATE TABLE posts (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
        );
      `);

      const result = await introspect(driver);

      expect(result.tables).toHaveLength(2);
      expect(result.tables.map((t) => t.name).sort()).toEqual(["posts", "users"]);

      expect(result.foreign_keys).toHaveLength(1);
      expect(result.foreign_keys[0].table).toBe("posts");
      expect(result.foreign_keys[0].column).toBe("user_id");
      expect(result.foreign_keys[0].referenced_table).toBe("users");
      expect(result.foreign_keys[0].referenced_column).toBe("id");
      expect(result.foreign_keys[0].on_update).toBe("CASCADE");
      expect(result.foreign_keys[0].on_delete).toBe("CASCADE");
    });

    it("should introspect indices (unique and non-unique)", async () => {
      await executeStatements(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          sku TEXT NOT NULL,
          name TEXT NOT NULL,
          price REAL
        );
        
        CREATE UNIQUE INDEX idx_products_sku ON products(sku);
        CREATE INDEX idx_products_name ON products(name);
      `);

      const result = await introspect(driver);

      expect(result.indices).toHaveLength(2);

      const uniqueIndex = result.indices.find((i) => i.name === "idx_products_sku");
      expect(uniqueIndex).toBeDefined();
      expect(uniqueIndex?.table).toBe("products");
      expect(uniqueIndex?.columns).toEqual(["sku"]);
      expect(uniqueIndex?.unique).toBe(true);

      const nonUniqueIndex = result.indices.find((i) => i.name === "idx_products_name");
      expect(nonUniqueIndex).toBeDefined();
      expect(nonUniqueIndex?.table).toBe("products");
      expect(nonUniqueIndex?.columns).toEqual(["name"]);
      expect(nonUniqueIndex?.unique).toBe(false);
    });

    it("should handle complex data types with precision and length", async () => {
      await executeStatements(`
        CREATE TABLE transactions (
          id INTEGER PRIMARY KEY,
          description VARCHAR(255),
          amount DECIMAL(10,2) NOT NULL,
          reference_code CHAR(8)
        );
      `);

      const result = await introspect(driver);

      expect(result.columns).toHaveLength(4);

      const descriptionColumn = result.columns.find((c) => c.name === "description");
      expect(descriptionColumn).toBeDefined();
      expect(descriptionColumn?.data_type).toBe("varchar");
      expect(descriptionColumn?.character_maximum_length).toBe(255);

      const amountColumn = result.columns.find((c) => c.name === "amount");
      expect(amountColumn).toBeDefined();
      expect(amountColumn?.data_type).toBe("decimal");
      expect(amountColumn?.precision).toEqual({
        precision: 10,
        scale: 2,
      });

      const referenceColumn = result.columns.find((c) => c.name === "reference_code");
      expect(referenceColumn).toBeDefined();
      expect(referenceColumn?.data_type).toBe("char");
      expect(referenceColumn?.character_maximum_length).toBe(8);
    });

    // Add this test within the integration tests describe.each block, alongside the other integration tests

    it("should correctly extract column-level check constraints", async () => {
      await executeStatements(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price DECIMAL(10,2) CHECK (price >= 0 AND price <= 1000000),
      rating INTEGER CHECK (rating BETWEEN 1 AND 5),
      status TEXT CHECK (status IN ('active', 'inactive', 'pending')),
      code TEXT CHECK (length(code) = 8),
      discount_percent DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100)
    );
  `);

      const result = await introspect(driver);

      expect(result.columns).toHaveLength(7);

      // Find and verify check constraints for each relevant column
      const priceColumn = result.columns.find((c) => c.name === "price");
      expect(priceColumn?.check_constraint).toContain("CHECK (price >= 0 AND price <= 1000000)");

      const ratingColumn = result.columns.find((c) => c.name === "rating");
      expect(ratingColumn?.check_constraint).toContain("CHECK (rating BETWEEN 1 AND 5)");

      const statusColumn = result.columns.find((c) => c.name === "status");
      expect(statusColumn?.check_constraint).toContain(
        "CHECK (status IN ('active', 'inactive', 'pending'))",
      );

      const codeColumn = result.columns.find((c) => c.name === "code");
      expect(codeColumn?.check_constraint).toContain("CHECK (length(code) = 8)");

      const discountColumn = result.columns.find((c) => c.name === "discount_percent");
      expect(discountColumn?.check_constraint).toContain(
        "CHECK (discount_percent >= 0 AND discount_percent <= 100)",
      );
    });

    it("should handle tables with multiple check constraints on different columns", async () => {
      await executeStatements(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      quantity INTEGER CHECK (quantity > 0),
      total_amount DECIMAL(10,2) CHECK (total_amount > 0),
      status TEXT CHECK (status IN ('pending', 'completed', 'cancelled')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP CHECK (updated_at >= created_at)
    );
  `);

      const result = await introspect(driver);

      const quantityColumn = result.columns.find((c) => c.name === "quantity");
      expect(quantityColumn?.check_constraint).toContain("CHECK (quantity > 0)");

      const amountColumn = result.columns.find((c) => c.name === "total_amount");
      expect(amountColumn?.check_constraint).toContain("CHECK (total_amount > 0)");

      const statusColumn = result.columns.find((c) => c.name === "status");
      expect(statusColumn?.check_constraint).toContain(
        "CHECK (status IN ('pending', 'completed', 'cancelled'))",
      );

      const updatedAtColumn = result.columns.find((c) => c.name === "updated_at");
      expect(updatedAtColumn?.check_constraint).toContain("CHECK (updated_at >= created_at)");
    });

    it("should introspect triggers", async () => {
      await executeStatements(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE logs (
          id INTEGER PRIMARY KEY,
          user_id INTEGER,
          action TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TRIGGER after_insert_user 
        AFTER INSERT ON users 
        BEGIN
          INSERT INTO logs (user_id, action) VALUES (NEW.id, 'INSERT');
        END;
      `);

      const result = await introspect(driver);

      expect(result.triggers).toHaveLength(1);
      expect(result.triggers[0].name).toBe("after_insert_user");
      expect(result.triggers[0].table).toBe("users");
      expect(result.triggers[0].sql).toContain("CREATE TRIGGER after_insert_user");
      expect(result.triggers[0].sql).toContain("AFTER INSERT ON users");
    });

    it("should introspect multi-column primary keys", async () => {
      await executeStatements(`
        CREATE TABLE order_items (
          order_id INTEGER,
          product_id INTEGER,
          quantity INTEGER NOT NULL,
          PRIMARY KEY (order_id, product_id)
        );
      `);

      const result = await introspect(driver);

      expect(result.primary_keys).toHaveLength(1);
      expect(result.primary_keys[0].table).toBe("order_items");
      expect(result.primary_keys[0].column).toBe("order_id,product_id");
      expect(result.primary_keys[0].field_count).toBe(2);
    });

    it("should introspect complex constraints", async () => {
      await executeStatements(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          price REAL CHECK (price > 0),
          stock INTEGER DEFAULT 0 CHECK (stock >= 0),
          status TEXT CHECK (status IN ('available', 'discontinued', 'out_of_stock'))
        );
      `);

      const result = await introspect(driver);

      expect(result.tables).toHaveLength(1);
      expect(result.columns).toHaveLength(5);

      // SQLite stores CHECK constraints within the table SQL statement
      expect(result.tables[0].sql).toContain("CHECK (price > 0)");
      expect(result.tables[0].sql).toContain("CHECK (stock >= 0)");
      expect(result.tables[0].sql).toContain(
        "CHECK (status IN ('available', 'discontinued', 'out_of_stock'))",
      );
    });

    it("should handle composite foreign keys", async () => {
      await executeStatements(`
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER NOT NULL
        );
        
        CREATE TABLE order_details (
          order_id INTEGER,
          line_number INTEGER,
          product_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          PRIMARY KEY (order_id, line_number),
          FOREIGN KEY (order_id) REFERENCES orders(id)
        );
      `);

      const result = await introspect(driver);

      expect(result.foreign_keys).toHaveLength(1);
      expect(result.foreign_keys[0].table).toBe("order_details");
      expect(result.foreign_keys[0].column).toBe("order_id");
      expect(result.foreign_keys[0].referenced_table).toBe("orders");
      expect(result.foreign_keys[0].referenced_column).toBe("id");
    });

    // This test verifies that we correctly handle all the types that our schema definition supports
    it("should introspect a database with all supported schema elements", async () => {
      await executeStatements(`
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT
        );
        
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          category_id INTEGER,
          name TEXT NOT NULL,
          sku VARCHAR(50) UNIQUE,
          price DECIMAL(10,2) NOT NULL,
          weight REAL,
          in_stock BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON UPDATE CASCADE ON DELETE SET NULL
        );
        
        CREATE INDEX idx_products_name ON products(name);
        CREATE UNIQUE INDEX idx_products_sku ON products(sku);
        
        CREATE TABLE inventory_logs (
          id INTEGER PRIMARY KEY,
          product_id INTEGER,
          action TEXT,
          quantity INTEGER,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TRIGGER after_update_product_stock
        AFTER UPDATE OF in_stock ON products
        WHEN OLD.in_stock != NEW.in_stock
        BEGIN
          INSERT INTO inventory_logs (product_id, action, quantity)
          VALUES (NEW.id, CASE WHEN NEW.in_stock THEN 'RESTOCK' ELSE 'OUT_OF_STOCK' END, 0);
        END;
      `);

      const result = await introspect(driver);

      // Verify all schema object types are correctly introspected
      expect(result.tables).toHaveLength(3);
      expect(result.columns.length).toBeGreaterThan(10); // All columns across tables
      expect(result.indices).toHaveLength(4); // two explicit, two sqlite_autoindex_*
      expect(result.foreign_keys).toHaveLength(1);
      expect(result.primary_keys).toHaveLength(3); // One for each table
      expect(result.triggers).toHaveLength(1);

      // Spot check specific objects
      expect(result.tables.map((t) => t.name).sort()).toEqual([
        "categories",
        "inventory_logs",
        "products",
      ]);

      const priceColumn = result.columns.find((c) => c.name === "price" && c.table === "products");
      expect(priceColumn).toBeDefined();
      expect(priceColumn?.data_type).toBe("decimal");
      expect(priceColumn?.precision).toEqual({
        precision: 10,
        scale: 2,
      });

      const skuIndex = result.indices.find((i) => i.name === "idx_products_sku");
      expect(skuIndex).toBeDefined();
      expect(skuIndex?.unique).toBe(true);

      const categoryFk = result.foreign_keys.find(
        (fk) => fk.table === "products" && fk.column === "category_id",
      );
      expect(categoryFk).toBeDefined();
      expect(categoryFk?.on_delete).toBe("SET NULL");

      const trigger = result.triggers[0];
      expect(trigger.name).toBe("after_update_product_stock");
      expect(trigger.table).toBe("products");
    });
  });
});
