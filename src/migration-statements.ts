import { compareSchema } from "./compare-schema";
import type { SchemaDiff } from "./compare/types";
import { getDriver, getNextDriver } from "./driver";
import { generateDDL } from "./generate-ddl";
import { introspect } from "./introspect";
import type { MigrationPlan } from "./migration-plan";
import { createMigrationPlan } from "./migration-plan";
import type { SQLite } from "./sqlite";

export type MigrationWarning = {
  type: "destructive" | "caution";
  message: string;
};

export type MigrationPreview = {
  statements: string[];
  warnings: MigrationWarning[];
  plan: MigrationPlan;
  diff: SchemaDiff;
};

export async function getMigrationStatements(client: SQLite, ddl: string): Promise<string[]> {
  const preview = await getMigrationPreview(client, ddl);
  return preview.statements;
}

export async function getMigrationPreview(client: SQLite, ddl: string): Promise<MigrationPreview> {
  const currDriver = getDriver(client);
  const currSchema = await introspect(currDriver);

  const nextDriver = await getNextDriver(client, ddl);
  const nextSchema = await introspect(nextDriver);

  const diff = compareSchema(currSchema, nextSchema);
  const migrationPlan = createMigrationPlan(diff);
  const statements = generateDDL(migrationPlan, currSchema, nextSchema);
  const warnings = generateWarnings(migrationPlan, diff);

  return { statements, warnings, plan: migrationPlan, diff };
}

function generateWarnings(plan: MigrationPlan, diff: SchemaDiff): MigrationWarning[] {
  const warnings: MigrationWarning[] = [];

  for (const op of plan) {
    switch (op.type) {
      case "drop":
        if (op.current.type === "table") {
          warnings.push({
            type: "destructive",
            message: `Table "${op.current.name}" will be dropped. All data in this table will be lost.`,
          });
        } else if (op.current.type === "column") {
          warnings.push({
            type: "destructive",
            message: `Column "${op.current.name}" will be dropped from table "${op.current.table}". Data in this column will be lost.`,
          });
        }
        break;

      case "recreate": {
        // Check for columns that exist in current but not in target (data loss)
        const currentCols = diff.current.columns
          .filter((c) => c.table === op.current.name)
          .map((c) => c.name);
        const targetCols = diff.desired.columns
          .filter((c) => c.table === op.target.name)
          .map((c) => c.name);
        const droppedCols = currentCols.filter((name) => !targetCols.includes(name));

        if (droppedCols.length > 0) {
          warnings.push({
            type: "destructive",
            message: `Table "${op.current.name}" will be recreated. Column(s) ${droppedCols.map((c) => `"${c}"`).join(", ")} will be dropped. Data in these columns will be lost.`,
          });
        } else {
          warnings.push({
            type: "caution",
            message: `Table "${op.current.name}" will be recreated. Data will be preserved, but this operation is not atomic outside a transaction.`,
          });
        }
        break;
      }
    }
  }

  return warnings;
}
