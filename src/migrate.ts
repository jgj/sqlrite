import { getDriver } from "./driver";
import { type MigrationOptions, getMigrationPreview } from "./migration-statements";
import type { SQLite } from "./sqlite";

/**
 * Execute the migration plan for a given database and desired schema
 *
 * @param client A sqlite client
 * @param ddl A string containing all the DDL create statements representing
 *            the desired database schema
 * @param options Migration options that influence which differences produce statements
 */
export async function migrate(client: SQLite, ddl: string, options: MigrationOptions = {}) {
  const { statements, warnings } = await getMigrationPreview(client, ddl, options);
  const driver = getDriver(client);
  const result = await driver.migrate(statements);
  return { ...result, statements, warnings };
}
