import {
  type BetterSqlite3Database,
  type LibsqlClient,
  type NodeSqliteDatabase,
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

const getLibsqlDriver: DriverFactory<LibsqlClient> = (client: LibsqlClient) => {
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

const getBetterSqlite3Driver: DriverFactory<BetterSqlite3Database> = (
  client: BetterSqlite3Database,
) => {
  const query = async <T>(sql: string) => {
    return client.prepare(sql).all() as T[];
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

const getNodeSqliteDriver: DriverFactory<NodeSqliteDatabase> = (client: NodeSqliteDatabase) => {
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
      return preservingLegacyAlterTable(getLibsqlDriver(client));
    case isBetterSqlite3Database(client):
      return preservingLegacyAlterTable(getBetterSqlite3Driver(client));
    case isNodeSqliteDatabase(client):
      return preservingLegacyAlterTable(getNodeSqliteDriver(client));
  }
  throw new TypeError("Unsupported client");
};

// A migration may switch PRAGMA legacy_alter_table (the FTS5 handler does to
// drop a contentless_unindexed table). The pragma belongs to the connection
// and is not undone by a rollback, so the caller's setting is put back once
// the migration has run, whether it succeeded or not.
function preservingLegacyAlterTable(driver: Driver): Driver {
  const migrate = async (sql: string[]) => {
    if (!sql.some((stmt) => /legacy_alter_table/i.test(stmt))) return driver.migrate(sql);
    const [row] = await driver.query<{ legacy_alter_table: unknown }>("PRAGMA legacy_alter_table");
    const setting = Number(row?.legacy_alter_table ?? 0) ? "ON" : "OFF";
    try {
      return await driver.migrate(sql);
    } finally {
      await driver.execute(`PRAGMA legacy_alter_table = ${setting}`);
    }
  };
  return { ...driver, migrate };
}

/**
 * Build the desired schema in a scratch in-memory database of the same kind as
 * `client`. `prepare` runs on the scratch client before the DDL, so extension
 * modules the DDL uses can be loaded first.
 */
export const getNextDriver = async <C extends SQLite>(
  client: C,
  ddl: string,
  prepare?: (client: C) => void | Promise<void>,
) => {
  const scratch = await getScratchClient(client, prepare !== undefined);
  // The scratch client is of the same driver as `client`
  await prepare?.(scratch as C);
  const driver = getDriver(scratch);
  await driver.execute(ddl);
  return driver;
};

const getScratchClient = async (client: SQLite, withHook: boolean): Promise<SQLite> => {
  switch (true) {
    case isLibsqlClient(client):
      return getLibsqlClient();
    case isBetterSqlite3Database(client):
      return getBetterSqlite3Database();
    case isNodeSqliteDatabase(client):
      // node:sqlite only allows loadExtension() when the database was opened
      // with allowExtension; it cannot be enabled afterwards. Opening with
      // allowExtension throws under Node's permission model (and Deno without
      // --allow-ffi), so it is only asked for when a hook may load an extension.
      return withHook ? getNodeSqliteDatabase({ allowExtension: true }) : getNodeSqliteDatabase();
  }

  throw new TypeError("Unsupported client");
};
