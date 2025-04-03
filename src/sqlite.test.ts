import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getBetterSqlite3Database,
  getLibsqlClient,
  isBetterSqlite3Database,
  isLibsqlClient,
} from "./sqlite";

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
