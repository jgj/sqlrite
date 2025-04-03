import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";

export type SQLite = Client | Database;

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
  return "prepare" in sqlite;
}
