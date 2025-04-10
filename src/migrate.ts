import { getDriver } from "./driver";
import { getMigrationStatements } from "./migration-statements";
import type { SQLite } from "./sqlite";

/**
 * Execute the migration plan for a given database and desired schema
 *
 * @param client A sqlite client
 * @param ddl A string containing all the DDL create statements representing
 *            the desired database schema
 */
export async function migrate(client: SQLite, ddl: string) {
  const statements = await getMigrationStatements(client, ddl);
  const driver = getDriver(client);
  const result = await driver.migrate(statements);
  return { ...result, statements };
}
