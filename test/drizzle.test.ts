import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDriver } from "~/driver";
import { fromDrizzle } from "~/drizzle";
import { migrate } from "~/migrate";
import { getLibsqlClient, getNodeSqliteDatabase } from "~/sqlite";
import type { SQLite } from "~/sqlite";

describe("fromDrizzle", () => {
  it("generates valid DDL from a basic table", () => {
    const users = sqliteTable("users", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name").notNull(),
      email: text("email").notNull().unique(),
    });

    const ddl = fromDrizzle(users);
    expect(ddl).toContain("CREATE TABLE");
    expect(ddl).toContain('"users"');
    expect(ddl).toContain("PRIMARY KEY AUTOINCREMENT");
    expect(ddl).toContain("NOT NULL");
    expect(ddl).toContain("UNIQUE");
  });

  it("generates DDL with defaults", () => {
    const settings = sqliteTable("settings", {
      id: integer("id").primaryKey(),
      active: integer("active", { mode: "boolean" }).default(true),
      count: integer("count").default(0),
      name: text("name").default("unnamed"),
      rate: real("rate").default(1.5),
    });

    const ddl = fromDrizzle(settings);
    expect(ddl).toContain("DEFAULT 1"); // true -> 1
    expect(ddl).toContain("DEFAULT 0");
    expect(ddl).toContain("DEFAULT 'unnamed'");
    expect(ddl).toContain("DEFAULT 1.5");
  });

  it("generates DDL with SQL default expressions", () => {
    const events = sqliteTable("events", {
      id: integer("id").primaryKey(),
      createdAt: text("created_at").default(sql`(datetime('now'))`),
    });

    const ddl = fromDrizzle(events);
    expect(ddl).toContain("DEFAULT (datetime('now'))");
  });

  it("generates DDL with foreign keys", () => {
    const users = sqliteTable("users", {
      id: integer("id").primaryKey(),
    });

    const posts = sqliteTable("posts", {
      id: integer("id").primaryKey(),
      userId: integer("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    });

    const ddl = fromDrizzle(users, posts);
    expect(ddl).toContain('REFERENCES "users"("id")');
    expect(ddl).toContain("ON DELETE CASCADE");
  });

  it("generates DDL with indexes", () => {
    const events = sqliteTable(
      "events",
      {
        id: integer("id").primaryKey(),
        type: text("type").notNull(),
        userId: integer("user_id").notNull(),
      },
      (t) => [index("idx_events_type").on(t.type), uniqueIndex("idx_events_user").on(t.userId)],
    );

    const ddl = fromDrizzle(events);
    expect(ddl).toContain('CREATE INDEX "idx_events_type"');
    expect(ddl).toContain('CREATE UNIQUE INDEX "idx_events_user"');
  });

  it("generates DDL with composite primary key", () => {
    const membership = sqliteTable(
      "membership",
      {
        userId: integer("user_id").notNull(),
        groupId: integer("group_id").notNull(),
        role: text("role").default("member"),
      },
      (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
    );

    const ddl = fromDrizzle(membership);
    expect(ddl).toContain('PRIMARY KEY ("user_id", "group_id")');
  });

  it("generates DDL with check constraints", () => {
    const products = sqliteTable(
      "products",
      {
        id: integer("id").primaryKey(),
        price: real("price").notNull(),
      },
      (t) => [check("price_check", sql`${t.price} > 0`)],
    );

    const ddl = fromDrizzle(products);
    expect(ddl).toContain("CHECK");
    expect(ddl).toContain("> 0");
  });

  it("generates DDL with generated columns", () => {
    const products = sqliteTable("products", {
      id: integer("id").primaryKey(),
      price: real("price").notNull(),
      qty: integer("qty").notNull(),
      total: real("total").generatedAlwaysAs(sql`"price" * "qty"`, { mode: "stored" }),
    });

    const ddl = fromDrizzle(products);
    expect(ddl).toContain("GENERATED ALWAYS AS");
    expect(ddl).toContain("STORED");
  });
});

describe("fromDrizzle integration", () => {
  describe.each([
    ["libsql", getLibsqlClient],
    ["node:sqlite", getNodeSqliteDatabase],
  ])("using %s", (clientName, getClient) => {
    let client: SQLite;

    beforeEach(async () => {
      client = await getClient();
    });

    afterEach(async () => {
      if ("close" in client) {
        await client.close();
      }
    });

    it("migrates a basic schema and is idempotent", async () => {
      const users = sqliteTable("users", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
        email: text("email").notNull().unique(),
      });

      const ddl = fromDrizzle(users);
      const first = await migrate(client, ddl);
      expect(first.success).toBe(true);

      const second = await migrate(client, ddl);
      expect(second.statements).toEqual([]);
    });

    it("migrates a complex multi-table schema and is idempotent", async () => {
      const categories = sqliteTable("categories", {
        id: integer("id").primaryKey(),
        name: text("name").notNull(),
      });

      const products = sqliteTable(
        "products",
        {
          id: integer("id").primaryKey(),
          name: text("name").notNull(),
          categoryId: integer("category_id")
            .notNull()
            .references(() => categories.id, { onDelete: "cascade" }),
          price: real("price").notNull(),
          inStock: integer("in_stock").notNull().default(1),
        },
        (t) => [
          index("idx_products_category").on(t.categoryId),
          check("price_positive", sql`${t.price} > 0`),
        ],
      );

      const ddl = fromDrizzle(categories, products);
      const first = await migrate(client, ddl);
      expect(first.success).toBe(true);

      const second = await migrate(client, ddl);
      expect(second.statements).toEqual([]);
    });

    it("migrates a schema with generated columns and is idempotent", async () => {
      const products = sqliteTable("products", {
        id: integer("id").primaryKey(),
        price: real("price").notNull(),
        qty: integer("qty").notNull(),
        total: real("total").generatedAlwaysAs(sql`"price" * "qty"`, { mode: "stored" }),
      });

      const ddl = fromDrizzle(products);
      const first = await migrate(client, ddl);
      expect(first.success).toBe(true);

      const second = await migrate(client, ddl);
      expect(second.statements).toEqual([]);
    });

    it("migrates a schema with composite PK and is idempotent", async () => {
      const membership = sqliteTable(
        "membership",
        {
          userId: integer("user_id").notNull(),
          groupId: integer("group_id").notNull(),
          role: text("role").default("member"),
        },
        (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
      );

      const ddl = fromDrizzle(membership);
      const first = await migrate(client, ddl);
      expect(first.success).toBe(true);

      const second = await migrate(client, ddl);
      expect(second.statements).toEqual([]);
    });

    it("evolves a drizzle schema and is idempotent", async () => {
      const usersV1 = sqliteTable("users", {
        id: integer("id").primaryKey(),
        name: text("name").notNull(),
      });

      // Migrate to v1
      await migrate(client, fromDrizzle(usersV1));

      // Evolve to v2: add column
      const usersV2 = sqliteTable("users", {
        id: integer("id").primaryKey(),
        name: text("name").notNull(),
        email: text("email").default(""),
      });

      const ddl2 = fromDrizzle(usersV2);
      const second = await migrate(client, ddl2);
      expect(second.success).toBe(true);

      const third = await migrate(client, ddl2);
      expect(third.statements).toEqual([]);
    });
  });
});
