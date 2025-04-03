import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";

export type SQLite = Client | Database;
