import type { DatabaseSync, DatabaseSyncOptions } from "node:sqlite";
import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";

// The client types below declare only what sqlrite uses of each driver (and
// close(), which every driver has), so the published type declarations do not
// import @libsql/client, better-sqlite3 or node:sqlite: a consumer installs
// only the driver it uses.

/** A libsql client (`Client` from @libsql/client) */
export interface LibsqlClient {
  execute(sql: string): Promise<{ rows: unknown[] }>;
  executeMultiple(sql: string): Promise<void>;
  migrate(stmts: string[]): Promise<unknown>;
  close(): void;
}

/** A better-sqlite3 database (`Database` from better-sqlite3) */
export interface BetterSqlite3Database {
  prepare(sql: string): { all(): unknown[]; run(): unknown };
  exec(sql: string): unknown;
  pragma(source: string): unknown;
  transaction(fn: (stmts: string[]) => void): { deferred(stmts: string[]): void };
  close(): unknown;
}

/** A node:sqlite database (`DatabaseSync` from node:sqlite) */
export interface NodeSqliteDatabase {
  prepare(sql: string): { all(): unknown[]; run(): unknown };
  exec(sql: string): void;
  createSession(): unknown;
  close(): void;
}

export type SQLite = LibsqlClient | BetterSqlite3Database | NodeSqliteDatabase;

export async function getLibsqlClient(): Promise<Client> {
  const { createClient } = await import("@libsql/client");
  return createClient({ url: ":memory:" });
}

export function isLibsqlClient(sqlite: SQLite): sqlite is LibsqlClient {
  return "execute" in sqlite && !("prepare" in sqlite);
}

export async function getBetterSqlite3Database(): Promise<Database> {
  const { default: Database } = await import("better-sqlite3");
  return new Database(":memory:");
}

export function isBetterSqlite3Database(sqlite: SQLite): sqlite is BetterSqlite3Database {
  return "prepare" in sqlite && "transaction" in sqlite;
}

export async function getNodeSqliteDatabase(options?: DatabaseSyncOptions): Promise<DatabaseSync> {
  const { DatabaseSync } = await import("node:sqlite");
  // DatabaseSync rejects an explicit undefined options argument
  return options ? new DatabaseSync(":memory:", options) : new DatabaseSync(":memory:");
}

export function isNodeSqliteDatabase(sqlite: SQLite): sqlite is NodeSqliteDatabase {
  return "prepare" in sqlite && "createSession" in sqlite;
}
