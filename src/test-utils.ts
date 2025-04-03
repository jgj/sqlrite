import { createClient } from "@libsql/client";
import Database from "better-sqlite3";

export function getLibsqlClient() {
  return createClient({ url: ":memory:" });
}

export function getBetterSqlite3Database() {
  return new Database(":memory:");
}
