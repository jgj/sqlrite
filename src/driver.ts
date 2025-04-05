import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";
import {
  type SQLite,
  getBetterSqlite3Database,
  getLibsqlClient,
  isBetterSqlite3Database,
  isLibsqlClient,
} from "./sqlite";

export interface Driver {
  execute(sql: string): Promise<void>;
  query<T = unknown>(sql: string): Promise<T[]>;
  migrate: (sql: string[]) => Promise<boolean>;
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

  const migrate = async (sql: string[]) => {
    try {
      await client.migrate(sql);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };
  return { execute, query, migrate };
};

const getBetterSqlite3Driver: DriverFactory<Database> = (client: Database) => {
  const query = async <T>(sql: string) => {
    const result = await client.prepare<unknown[], T>(sql).all();
    return result;
  };

  const execute = async <T>(sql: string) => {
    await client.exec(sql);
  };

  const migrate = async (sql: string[]) => {
    try {
      client
        .transaction((stmts: string[]) => {
          client.pragma("foreign_keys = off");
          for (const stmt of stmts) client.prepare(stmt).run();
          client.pragma("foreign_keys = on");
        })
        .deferred(sql);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };
  return { execute, query, migrate };
};

export type DriverType = "sqlite" | "libsql";
export const getDriverType: (client: SQLite) => DriverType = (client: SQLite) => {
  switch (true) {
    case isLibsqlClient(client):
      return "libsql";
    case isBetterSqlite3Database(client):
      return "sqlite";
  }
  throw new TypeError("Unsupported client");
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

export const getNextDriver = async (client: SQLite, ddl: string) => {
  switch (true) {
    case isLibsqlClient(client): {
      const driver = getLibsqlDriver(await getLibsqlClient());
      await driver.execute(ddl);
      return driver;
    }
    case isBetterSqlite3Database(client): {
      const driver = getBetterSqlite3Driver(await getBetterSqlite3Database());
      await driver.execute(ddl);
      return driver;
    }
  }

  throw new TypeError("Unsupported client");
};
