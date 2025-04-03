import type { SQLite } from "./sqlite";

/**
 * Execute the migration plan for a given database and desired schema
 *
 * @param client A sqlite client
 * @param ddl A string containing all the DDL create statements representing
 *            the desired database schema
 */
export async function migrate(client: SQLite, ddl: string) {}

/**
 * Get the migration plan for a given database and desired schema
 *
 * @param client A sqlite client
 * @param ddl DDL statements reflecting the desired database schema
 */
export async function getMigrationPlan(client: SQLite, ddl: string) {}
