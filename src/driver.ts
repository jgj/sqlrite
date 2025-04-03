import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";
import { type SQLite, isBetterSqlite3Database, isLibsqlClient } from "./sqlite";

export interface Driver {
  execute(sql: string): Promise<void>;
  query<T = unknown>(sql: string): Promise<T[]>;
}

type DriverFactory<C extends SQLite> = (client: C) => Driver;

const getLibsqlDriver: DriverFactory<Client> = (client: Client) => {
  const query = async <T>(sql: string) => {
    const result = await client.execute(sql);
    return result.rows as T[];
  };
  const execute = async (sql: string) => {
    await query(sql);
  };
  return { execute, query };
};

const getBetterSqlite3Driver: DriverFactory<Database> = (client: Database) => {
  const query = async <T>(sql: string) => {
    const result = await client.prepare<unknown[], T>(sql).all();
    return result;
  };
  const execute = async <T>(sql: string) => {
    await client.prepare(sql).run();
  };
  return { execute, query };
};

export const getDriver: DriverFactory<SQLite> = (client: SQLite) => {
  switch (true) {
    case isLibsqlClient(client):
      return getLibsqlDriver(client);
    case isBetterSqlite3Database(client):
      return getBetterSqlite3Driver(client);
  }
  throw new TypeError("Unsupported client");
};
