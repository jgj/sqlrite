import type { DatabaseSync } from "node:sqlite";
import type { Client } from "@libsql/client";
import type { Database } from "better-sqlite3";
import {
  type SQLite,
  getBetterSqlite3Database,
  getLibsqlClient,
  getNodeSqliteDatabase,
  isBetterSqlite3Database,
  isLibsqlClient,
  isNodeSqliteDatabase,
} from "./sqlite";
import { MigrationError, type Result, isTesting, result } from "./utils";

export interface Driver {
  execute(sql: string): Promise<void>;
  query<T = unknown>(sql: string): Promise<T[]>;
  migrate: (sql: string[]) => Promise<Result>;
}

type DriverFactory<C extends SQLite> = (client: C) => Driver;

const getLibsqlDriver: DriverFactory<Client> = (client: Client) => {
  const query = async <T>(sql: string) => {
    const result = await client.execute(sql);
    return result.rows as T[];
  };

  const execute = async (sql: string) => {
    await client.executeMultiple(sql);
  };

  const migrate = async (sql: string[]) => {
    try {
      await client.migrate(sql);
      return result();
    } catch (err) {
      !isTesting() && console.error(err);
      return result(err);
    }
  };
  return { execute, query, migrate };
};

const getBetterSqlite3Driver: DriverFactory<Database> = (client: Database) => {
  const query = async <T>(sql: string) => {
    const result = await client.prepare<unknown[], T>(sql).all();
    return result;
  };

  const execute = async (sql: string) => {
    await client.exec(sql);
  };

  const migrate = async (sql: string[]) => {
    try {
      client
        .transaction((stmts: string[]) => {
          client.pragma("foreign_keys = off");
          for (const [i, stmt] of stmts.entries()) {
            try {
              client.prepare(stmt).run();
            } catch (err) {
              throw err instanceof Error ? new MigrationError(i, stmt, err) : err;
            }
          }
          client.pragma("foreign_keys = on");
        })
        .deferred(sql);
      return result();
    } catch (err) {
      !isTesting() && console.error(err);
      return result(err);
    }
  };
  return { execute, query, migrate };
};

const getNodeSqliteDriver: DriverFactory<DatabaseSync> = (client: DatabaseSync) => {
  const query = async <T>(sql: string) => {
    return client.prepare(sql).all() as T[];
  };

  const execute = async (sql: string) => {
    client.exec(sql);
  };

  const migrate = async (sql: string[]) => {
    try {
      client.exec("PRAGMA foreign_keys = OFF");
      client.exec("BEGIN DEFERRED");
      for (const [i, stmt] of sql.entries()) {
        try {
          client.prepare(stmt).run();
        } catch (err) {
          throw err instanceof Error ? new MigrationError(i, stmt, err) : err;
        }
      }
      client.exec("COMMIT");
      client.exec("PRAGMA foreign_keys = ON");
      return result();
    } catch (err) {
      try {
        client.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      !isTesting() && console.error(err);
      return result(err);
    }
  };
  return { execute, query, migrate };
};

export type DriverType = "sqlite" | "libsql" | "node-sqlite";
export const getDriverType: (client: SQLite) => DriverType = (client: SQLite) => {
  switch (true) {
    case isLibsqlClient(client):
      return "libsql";
    case isBetterSqlite3Database(client):
      return "sqlite";
    case isNodeSqliteDatabase(client):
      return "node-sqlite";
  }
  throw new TypeError("Unsupported client");
};

export const getDriver: DriverFactory<SQLite> = (client: SQLite) => {
  switch (true) {
    case isLibsqlClient(client):
      return getLibsqlDriver(client);
    case isBetterSqlite3Database(client):
      return getBetterSqlite3Driver(client);
    case isNodeSqliteDatabase(client):
      return getNodeSqliteDriver(client);
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
    case isNodeSqliteDatabase(client): {
      const driver = getNodeSqliteDriver(await getNodeSqliteDatabase());
      await driver.execute(ddl);
      return driver;
    }
  }

  throw new TypeError("Unsupported client");
};
