import { compareSchema } from "./compare-schema";
import { getDriver, getNextDriver } from "./driver";
import { generateDDL } from "./generate-ddl";
import { introspect } from "./introspect";
import { createMigrationPlan } from "./migration-plan";
import type { SQLite } from "./sqlite";

export async function getMigrationStatements(client: SQLite, ddl: string) {
  const currDriver = getDriver(client);
  const currSchema = await introspect(currDriver);

  const nextDriver = await getNextDriver(client, ddl);
  const nextSchema = await introspect(nextDriver);

  const diff = compareSchema(currSchema, nextSchema);
  const migrationPlan = createMigrationPlan(diff);
  return generateDDL(migrationPlan, currSchema, nextSchema);
}
