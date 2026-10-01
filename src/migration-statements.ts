import { compareSchema } from "./compare-schema";
import type { SchemaDiff } from "./compare/types";
import { type Driver, getDriver, getNextDriver } from "./driver";
import { generateDDL } from "./generate-ddl";
import { introspect } from "./introspect";
import type { Column, IntrospectionResult } from "./introspection-result";
import {
  type VirtualTableOperation,
  getTableRenameMap,
  isVirtualTableOperation,
} from "./migration-operation";
import type { MigrationPlan } from "./migration-plan";
import { createMigrationPlan } from "./migration-plan";
import type { SQLite } from "./sqlite";
import { type UnloadedModuleShadows, revealDeclaredTables } from "./unloaded-modules";
import { columnsLookLikeRename, findByName, foldName, getColName } from "./utils";
import {
  getRecreateModule,
  getVirtualTableModule,
  resolveVirtualTable,
  sameModule,
} from "./virtual-tables/registry";
import type { VirtualTableModule } from "./virtual-tables/types";

export type MigrationWarning =
  | {
      type: "destructive" | "caution";
      message: string;
    }
  | {
      /**
       * A column the migration drops looks like it was renamed to a column it
       * adds to the same table. Its data is lost unless the rename is declared
       * with the renameColumns option: `{ [table]: { [from]: to } }`.
       */
      type: "possible_rename";
      message: string;
      table: string;
      from: string;
      to: string;
    };

export type MigrationOptions = {
  /**
   * Columns to rename, by table and then by current column name:
   * `{ users: { username: "name" } }`. A rename keeps the column's data under
   * its new name, by ALTER TABLE RENAME COLUMN or, when the table is
   * recreated, by copying it from the old name to the new one.
   *
   * Renames are never guessed. Without a declared rename, a column the
   * desired schema drops is dropped with its data, and a column it adds
   * starts empty. A dropped and an added column of the same table that look
   * alike are reported in a "possible_rename" warning, which names the
   * mapping to pass here.
   *
   * Each rename must name a column the current schema has and the desired
   * schema drops, and a column the desired schema adds to the same table;
   * otherwise the migration preview throws. A rename already carried out (the
   * current schema has the new name and not the old one) is skipped, so the
   * same options can be passed again after the migration has run.
   */
  renameColumns?: Record<string, Record<string, string>>;

  /**
   * When true, tables present in the current schema but absent from the desired
   * schema are not dropped. Indexes, triggers, and views that depend on those
   * tables are also left alone. Drop+create pairs that resolve to renames are
   * still emitted as renames. With `manageVirtualTables`, a table the desired
   * schema replaces by a virtual table of the same name (or the reverse) is
   * still dropped, as its name is needed.
   *
   * Useful when adopting sqlrite on an established database where some tables
   * intentionally aren't represented in the declared schema.
   *
   * @default false
   */
  ignoreTableDeletion?: boolean;

  /**
   * When true, column reordering between current and desired schemas does not
   * trigger a table recreation. Other column changes on the same table (data
   * type, nullability, default, etc.) still trigger recreation as usual.
   *
   * Useful when adopting sqlrite on an established database whose physical
   * column order has drifted from the declared schema and an immediate
   * full-table rewrite is undesirable.
   *
   * @default false
   */
  ignoreColumnOrder?: boolean;

  /**
   * When true, virtual tables (CREATE VIRTUAL TABLE ...) are created, dropped
   * and recreated to match the desired schema. How a change is carried out,
   * and whether the virtual table's data survives it, depends on the module.
   * Modules without a dedicated handler are compared by their normalized
   * argument text, are never renamed in place, and are recreated with
   * DROP + CREATE, which loses their data (a destructive warning is emitted).
   * `ignoreTableDeletion` also keeps virtual tables that are missing from the
   * desired schema.
   *
   * FTS5 tables have a dedicated handler: equivalent spellings of the same
   * definition (quoting, option case and order, tokenizer defaults, ...) are
   * not changes, a rename uses ALTER TABLE ... RENAME (except for a
   * contentless_unindexed table, which SQLite cannot rename correctly: it is
   * dropped and created, losing its data, with a destructive warning), and a
   * recreate keeps the rows and rowids of a table that stores its own
   * content, rebuilds an external-content index from its content table, and
   * keeps the runtime settings (rank, automerge, ...). An external-content
   * index is rebuilt when its content table or view is recreated, redefined
   * or replaced by another object of the same name, and recreated when its
   * content table is renamed.
   *
   * When false, virtual tables are left exactly as they are: they are never
   * created, dropped, altered or warned about. Their shadow tables are never
   * treated as regular tables either way.
   *
   * Every module used by the live database must be loaded on the live client
   * (loading extensions such as sqlite-vec there is the caller's job). SQLite
   * cannot recognize the shadow tables of a module that is not loaded; sqlrite
   * then treats tables named `<virtual table>_*` that the desired schema does
   * not declare as that table's shadow tables, leaves them untouched and says
   * so in a caution warning (whether or not this option is on).
   *
   * @default false
   */
  manageVirtualTables?: boolean;

  /**
   * Called with the scratch in-memory database that sqlrite builds the desired
   * schema in, before the desired DDL runs on it. Use it to load extension
   * modules the DDL needs (sqlite-vec, spatialite, ...); without them
   * CREATE VIRTUAL TABLE fails with "no such module".
   *
   * The client is of the same kind as the one passed to sqlrite:
   * - better-sqlite3: call `db.loadExtension(path)`.
   * - node:sqlite: call `db.loadExtension(path)`; the scratch database is
   *   opened with `allowExtension: true`.
   * - libsql (@libsql/client): the client has no extension-loading API, so the
   *   hook can only run SQL. Do not call `client.transaction()`: on an
   *   in-memory libsql client it silently switches to a new, empty database.
   *
   * The SQL function load_extension() is not authorized on any of the drivers;
   * use the JavaScript API. This hook only affects the scratch database;
   * loading extensions on the live client is the caller's job.
   */
  prepareNextDatabase?: (client: SQLite) => void | Promise<void>;
};

export type MigrationPreview = {
  statements: string[];
  warnings: MigrationWarning[];
  plan: MigrationPlan;
  diff: SchemaDiff;
};

export async function getMigrationStatements(
  client: SQLite,
  ddl: string,
  options: MigrationOptions = {},
): Promise<string[]> {
  const preview = await getMigrationPreview(client, ddl, options);
  return preview.statements;
}

export async function getMigrationPreview(
  client: SQLite,
  ddl: string,
  options: MigrationOptions = {},
): Promise<MigrationPreview> {
  const currDriver = getDriver(client);
  const liveSchema = await introspect(currDriver);

  const nextDriver = await getNextDriver(client, ddl, options.prepareNextDatabase);
  const nextSchema = await introspect(nextDriver);

  const { schema: currSchema, unloadedModuleShadows } = revealDeclaredTables(
    liveSchema,
    nextSchema.tables.map((t) => t.name),
  );

  const diff = compareSchema(currSchema, nextSchema);
  const migrationPlan = createMigrationPlan(diff, options);
  const statements = generateDDL(migrationPlan, currSchema, nextSchema);
  const tempShadows = await getShadowingTempObjects(currDriver, migrationPlan, statements);
  const warnings = [
    ...tempShadows.map((object) => ({
      type: "destructive" as const,
      message: tempShadowMessage(object),
    })),
    ...unloadedModuleShadows.map(unloadedModuleWarning),
    ...generateWarnings(migrationPlan, diff, options),
  ];

  return { statements, warnings, plan: migrationPlan, diff };
}

export type TempObject = { type: string; name: string };

/**
 * The temp objects (CREATE TEMP ...) of the live connection named like an
 * object the migration changes. The live schema is read from main, but the
 * statements name objects without a schema, and SQLite looks a bare name up
 * in temp first: they would change the temp object instead of the main one.
 */
export async function getShadowingTempObjects(
  driver: Driver,
  plan: MigrationPlan,
  statements: readonly string[],
): Promise<TempObject[]> {
  if (statements.length === 0) return [];
  const names = new Set<string>();
  for (const op of plan) {
    for (const object of [op.current, op.target]) {
      if (!object) continue;
      names.add(foldName(object.name));
      if ("table" in object) names.add(foldName(object.table));
    }
  }
  // The statements also name the objects a recreate drops and puts back
  // (views, triggers, shadow tables, ...); sqlrite quotes every name it writes
  for (const statement of statements) {
    for (const [, name = ""] of statement.matchAll(/"((?:[^"]|"")*)"/g)) {
      names.add(foldName(name.replaceAll('""', '"')));
    }
  }
  const temp = await driver.query<TempObject>("SELECT type, name FROM sqlite_temp_schema");
  return temp.filter((object) => names.has(foldName(object.name)));
}

export function tempShadowMessage({ type, name }: TempObject): string {
  return `The migration changes "${name}", but this connection also has a temp ${type} "${name}", which SQLite would change instead: the statements do not name a schema. The migration is refused until the temp ${type} is dropped or renamed.`;
}

// Tables taken to be shadow tables of a virtual table whose module is not
// loaded on the live client are left untouched, whatever the desired schema
// says about them; say so, as they may be regular tables
function unloadedModuleWarning({
  virtualTable,
  module,
  tables,
}: UnloadedModuleShadows): MigrationWarning {
  return {
    type: "caution",
    message: `Module "${module}" of virtual table "${virtualTable}" is not loaded on this connection, so table(s) ${tables.map((t) => `"${t}"`).join(", ")} are taken to be its shadow tables and left untouched. Load the module on the live client if they are regular tables.`,
  };
}

function generateWarnings(
  plan: MigrationPlan,
  diff: SchemaDiff,
  options: MigrationOptions,
): MigrationWarning[] {
  const warnings: MigrationWarning[] = [];
  const renamedTables = getTableRenameMap(plan);

  for (const op of plan) {
    if (isVirtualTableOperation(op)) {
      warnings.push(...generateVirtualTableWarnings(op, diff.desired, renamedTables));
      continue;
    }

    switch (op.type) {
      case "drop":
        if (op.current.type === "table") {
          warnings.push({
            type: "destructive",
            message: `Table "${op.current.name}" will be dropped. All data in this table will be lost.`,
          });
          if (options.manageVirtualTables) {
            warnings.push(...droppedDependencyWarnings(op.current.name, diff));
          }
        } else if (op.current.type === "column") {
          warnings.push({
            type: "destructive",
            message: `Column "${op.current.name}" will be dropped from table "${op.current.table}". Data in this column will be lost.`,
          });
        }
        break;

      case "recreate": {
        // Columns that exist in current but not in target lose their data,
        // unless they are renamed (the recreate copies them to the new name,
        // see buildColumnMapping in generate-ddl)
        const renames = op.columnRenames ?? [];
        const renamedFrom = new Set(renames.map((r) => r.from));
        const targetCols = diff.desired.columns
          .filter((c) => c.table === op.target.name)
          .map((c) => c.name);
        const droppedCols = diff.current.columns
          .filter((c) => c.table === op.current.name)
          .map((c) => c.name)
          .filter((name) => !targetCols.includes(name) && !renamedFrom.has(name));
        const renamed =
          renames.length > 0
            ? ` Column(s) ${renames.map((r) => `"${r.from}" → "${r.to}"`).join(", ")} will be renamed, keeping their data.`
            : "";

        if (droppedCols.length > 0) {
          warnings.push({
            type: "destructive",
            message: `Table "${op.current.name}" will be recreated. Column(s) ${droppedCols.map((c) => `"${c}"`).join(", ")} will be dropped. Data in these columns will be lost.${renamed}`,
          });
        } else {
          warnings.push({
            type: "caution",
            message: `Table "${op.current.name}" will be recreated.${renamed} Data will be preserved, but this operation is not atomic outside a transaction.`,
          });
        }
        break;
      }
    }
  }

  warnings.push(...possibleRenameWarnings(plan, diff));

  return warnings;
}

/**
 * Columns the migration drops that look like they were renamed to a column
 * it adds to the same table (see columnsLookLikeRename): a strict pass, then
 * a relaxed one, each column paired at most once. Columns the renameColumns
 * option renames are left out.
 */
function possibleRenameWarnings(plan: MigrationPlan, diff: SchemaDiff): MigrationWarning[] {
  const renamed = new Set<string>();
  for (const op of plan) {
    if (op.type === "rename" && op.current.type === "column" && op.target.type === "column") {
      renamed.add(getColName(op.current));
      renamed.add(getColName(op.target));
    } else if (op.type === "recreate" && !isVirtualTableOperation(op)) {
      for (const { from, to } of op.columnRenames ?? []) {
        renamed.add(`${op.current.name}.${from}`);
        renamed.add(`${op.current.name}.${to}`);
      }
    }
  }

  const warnings: MigrationWarning[] = [];
  for (const { current: table } of diff.table.modified) {
    const unrenamed = (columns: Column[]) =>
      columns.filter((col) => col.table === table.name && !renamed.has(getColName(col)));
    const removed = unrenamed(diff.column.removed);
    const added = unrenamed(diff.column.added);
    const paired = new Set<Column>();

    for (const strict of [true, false]) {
      for (const from of removed) {
        if (paired.has(from)) continue;
        const to = added.find(
          (col) => !paired.has(col) && columnsLookLikeRename(from, col, strict),
        );
        if (!to) continue;
        paired.add(from);
        paired.add(to);
        warnings.push({
          type: "possible_rename",
          table: table.name,
          from: from.name,
          to: to.name,
          message: `Column "${from.name}" of table "${table.name}" will be dropped and column "${to.name}" added. If "${to.name}" is "${from.name}" renamed, declare it with renameColumns: { ${JSON.stringify(table.name)}: { ${JSON.stringify(from.name)}: ${JSON.stringify(to.name)} } } to keep its data.`,
        });
      }
    }
  }
  return warnings;
}

// Warnings for virtual tables come from the module handler
function generateVirtualTableWarnings(
  op: VirtualTableOperation,
  desired: IntrospectionResult,
  renamedTables: ReadonlyMap<string, string>,
): MigrationWarning[] {
  switch (op.type) {
    case "create":
    case "rebuild": {
      const { handler, args } = resolveVirtualTable(op.target);
      return handler.warnings({ op, targetArgs: args, desired, renamedTables });
    }
    case "drop": {
      const { handler, args } = resolveVirtualTable(op.current);
      return handler.warnings({ op, currentArgs: args, desired, renamedTables });
    }
    case "recreate":
      // A recreate split in two steps is warned about once, at its first step
      if (op.step === "create") return [];
      if (!sameModule(op.current, op.target)) {
        // The current module's handler drops the table and the new module's
        // handler creates it (see generate-ddl), so each warns about its part
        return [
          {
            type: "caution",
            message: `Virtual table "${op.target.name}" will be recreated because its module changes: ${op.current.module} → ${op.target.module}.`,
          },
          ...generateVirtualTableWarnings(
            { type: "drop", current: op.current },
            desired,
            renamedTables,
          ),
          ...generateVirtualTableWarnings(
            { type: "create", target: op.target },
            desired,
            renamedTables,
          ),
        ];
      }
      return recreateOrRenameWarnings(op, getRecreateModule(op), desired, renamedTables);
    case "rename":
      return recreateOrRenameWarnings(
        op,
        getVirtualTableModule(op.target.module),
        desired,
        renamedTables,
      );
  }
}

function recreateOrRenameWarnings(
  op: VirtualTableOperation & { type: "rename" | "recreate" },
  handler: VirtualTableModule<unknown>,
  desired: IntrospectionResult,
  renamedTables: ReadonlyMap<string, string>,
): MigrationWarning[] {
  return handler.warnings({
    op,
    currentArgs: handler.parseArgs(op.current.args),
    targetArgs: handler.parseArgs(op.target.args),
    desired,
    renamedTables,
  });
}

// A table is dropped while a virtual table the desired schema keeps still
// reads from it (e.g. an FTS5 content= table). The virtual table is left in
// place, as declared, but it cannot read its rows until the table exists
// again, so say so. A view (or table) of the same name in the desired schema
// takes its place, and the virtual table reads from that instead.
function droppedDependencyWarnings(table: string, diff: SchemaDiff): MigrationWarning[] {
  const dropped = foldName(table);
  if (findByName(diff.desired.views, table) || findByName(diff.desired.tables, table)) return [];
  return diff.desired.virtual_tables
    .filter((vt) => {
      const { handler, args } = resolveVirtualTable(vt);
      return handler.dependencies(vt, args).some((dep) => foldName(dep) === dropped);
    })
    .map(
      (vt): MigrationWarning => ({
        type: "destructive",
        message: `Table "${table}" will be dropped, but virtual table "${vt.name}" in the desired schema reads from it. "${vt.name}" is kept as declared; queries that read its rows will fail until a table named "${table}" exists again.`,
      }),
    );
}
