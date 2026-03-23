import type { DatabaseSync } from "node:sqlite";
import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";

export type SQLite = Client | Database | DatabaseSync;

export async function getLibsqlClient() {
  const { createClient } = await import("@libsql/client");
  return createClient({ url: ":memory:" });
}

export function isLibsqlClient(sqlite: SQLite): sqlite is Client {
  return "execute" in sqlite && !("prepare" in sqlite);
}

export async function getBetterSqlite3Database() {
  const { default: Database } = await import("better-sqlite3");
  return new Database(":memory:");
}

export function isBetterSqlite3Database(sqlite: SQLite): sqlite is Database {
  return "prepare" in sqlite && "transaction" in sqlite;
}

export async function getNodeSqliteDatabase() {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(":memory:");
}

export function isNodeSqliteDatabase(sqlite: SQLite): sqlite is DatabaseSync {
  return "prepare" in sqlite && "createSession" in sqlite;
}
