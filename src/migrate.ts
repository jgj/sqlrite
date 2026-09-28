import { getDriver } from "./driver";
import {
  type MigrationOptions,
  getMigrationPreview,
  getShadowingTempObjects,
  tempShadowMessage,
} from "./migration-statements";
import type { SQLite } from "./sqlite";
import { result } from "./utils";

/**
 * Execute the migration plan for a given database and desired schema
 *
 * @param client A sqlite client
 * @param ddl A string containing all the DDL create statements representing
 *            the desired database schema
 * @param options Migration options that influence which differences produce statements
 */
export async function migrate(client: SQLite, ddl: string, options: MigrationOptions = {}) {
  const { statements, warnings, plan } = await getMigrationPreview(client, ddl, options);
  const driver = getDriver(client);
  // The statements would change a temp object instead of the main one it
  // shadows (see getShadowingTempObjects): refuse rather than report success
  const [shadow] = await getShadowingTempObjects(driver, plan, statements);
  if (shadow) {
    return { ...result(new Error(tempShadowMessage(shadow))), statements, warnings };
  }
  const outcome = await driver.migrate(statements);
  return { ...outcome, statements, warnings };
}
