import { describe, it, expect, beforeAll } from "vitest";
import {
  isLibsqlClient,
  isBetterSqlite3Database,
  getLibsqlClient,
  getBetterSqlite3Database,
} from "./sqlite";
import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";

describe("SQLite client detection", () => {
  let libsqlClient: Client;
  let betterSqlite3Db: Database;

  beforeAll(async () => {
    [libsqlClient, betterSqlite3Db] = await Promise.all([
      getLibsqlClient(),
      getBetterSqlite3Database(),
    ]);
  });

  describe("isLibsqlClient", () => {
    it.each([
      { client: "libsqlClient", expected: true, description: "should identify libsql client" },
      {
        client: "betterSqlite3Db",
        expected: false,
        description: "should reject better-sqlite3 database",
      },
    ])("$description", ({ client, expected }) => {
      const actualClient = client === "libsqlClient" ? libsqlClient : betterSqlite3Db;
      expect(isLibsqlClient(actualClient)).toBe(expected);
    });
  });

  describe("isBetterSqlite3Database", () => {
    it.each([
      {
        client: "betterSqlite3Db",
        expected: true,
        description: "should identify better-sqlite3 database",
      },
      { client: "libsqlClient", expected: false, description: "should reject libsql client" },
    ])("$description", ({ client, expected }) => {
      const actualClient = client === "libsqlClient" ? libsqlClient : betterSqlite3Db;
      expect(isBetterSqlite3Database(actualClient)).toBe(expected);
    });
  });
});
