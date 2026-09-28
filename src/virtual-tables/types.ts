import type { DDLStatement } from "../generate-ddl";
import type { IntrospectionResult, VirtualTable } from "../introspection-result";
import type { RecreateReason, VirtualTableOperation } from "../migration-operation";
import type { MigrationWarning } from "../migration-statements";

export type VirtualTableRecreateContext<Args> = {
  /** The virtual table as it exists in the live database */
  current: VirtualTable;
  /** The virtual table as declared in the desired schema */
  target: VirtualTable;
  currentArgs: Args;
  targetArgs: Args;
  /**
   * The desired schema: the end state of the migration. A recreate normally
   * runs after every table operation, so its statements see regular tables in
   * this shape and a handler can tell which tables it may read from. The drop
   * step of a recreate split in two (see `recreateSteps` and `dropFirst`)
   * runs before any table or view operation instead: its statements see the
   * current schema, not this one.
   */
  desired: IntrospectionResult;
  /**
   * The regular tables this migration renames: the new name by the current
   * name (folded by foldName). Omitted: no table is renamed.
   */
  renamedTables?: ReadonlyMap<string, string>;
};

export type VirtualTableRebuildContext<Args> = {
  target: VirtualTable;
  args: Args;
};

export type VirtualTableDependencyContext<Args> = {
  /** The desired virtual table whose dependency changed */
  target: VirtualTable;
  args: Args;
  /** The dependency name as returned by `dependencies()` */
  dependency: string;
  /**
   * - recreated: the table was rebuilt (CREATE temp, copy, DROP, RENAME); rowids
   *   of a table without an INTEGER PRIMARY KEY are renumbered. Also used when
   *   the relation holds different rows afterwards: a table below a view is
   *   recreated, a view is created or redefined, or a table or view is
   *   created under the name (e.g. replacing a view by a table)
   * - renamed: the table was renamed with ALTER TABLE ... RENAME
   */
  change: "recreated" | "renamed";
};

/**
 * - none: nothing to do
 * - rebuild: emit a RebuildOperation (requires `rebuild`)
 * - recreate: emit a VirtualTableRecreateOperation with the desired SQL
 */
export type DependencyReaction = "none" | "rebuild" | "recreate";

export type VirtualTableWarningContext<Args> = {
  op: VirtualTableOperation;
  /** Parsed arguments of `op.current`, when the operation has one */
  currentArgs?: Args;
  /** Parsed arguments of `op.target`, when the operation has one */
  targetArgs?: Args;
  /** The desired schema (see VirtualTableRecreateContext.desired) */
  desired: IntrospectionResult;
  /** See VirtualTableRecreateContext.renamedTables */
  renamedTables?: ReadonlyMap<string, string>;
};

/**
 * A handler for one virtual table module (fts5, rtree, ...). The handler owns
 * everything module specific: argument equivalence, rename support, the tables
 * the virtual table reads from, how data is carried across a recreate, how it
 * reacts when one of those tables changes, and the warnings it produces.
 *
 * Members use method syntax on purpose: method parameters are bivariant, so a
 * `VirtualTableModule<FtsArgs>` can be stored in the registry as a
 * `VirtualTableModule<unknown>`.
 */
export interface VirtualTableModule<Args> {
  /** Module name as written after USING; matched case-insensitively */
  name: string;

  /** Parse the raw text between the parentheses after the module name */
  parseArgs(args: string): Args;

  /**
   * Compare two parsed argument sets. Return one reason per difference that
   * requires the virtual table to be recreated; [] means the definitions are
   * equivalent and no statement is emitted.
   */
  diff(current: Args, desired: Args): RecreateReason[];

  /**
   * Whether ALTER TABLE ... RENAME may be used when a virtual table disappears
   * and an equivalent one (same module, `diff` empty) appears under a new name.
   * When false, a rename is carried out as DROP + CREATE.
   */
  supportsRename: boolean;

  /**
   * Narrows `supportsRename` for one virtual table, for modules where only
   * some configurations survive ALTER TABLE ... RENAME. Only consulted when
   * `supportsRename` is true; omitted means every table of the module can be
   * renamed.
   */
  canRename?(current: VirtualTable, args: Args): boolean;

  /** Names of the tables this virtual table reads from (e.g. an FTS5 content= table) */
  dependencies(target: VirtualTable, args: Args): string[];

  /**
   * Lowercase suffixes of the shadow tables (`<name>_<suffix>`) this virtual
   * table actually creates with these arguments. SQLite classifies a table as
   * a shadow table by its name alone (the module's xShadowName), even when
   * the virtual table never created it, e.g. a user table `docs_content` next
   * to an FTS5 table `docs` with external content. Such a table is treated as
   * a regular table when its suffix is not listed here. The names listed are
   * also those a rename of the virtual table takes and frees. Omitted: what is
   * known of FTS3/FTS4 decides for those modules (see fts3ShadowTables);
   * otherwise a table SQLite classifies as a shadow table of the virtual table
   * is one when its stored SQL writes its name quoted, as modules do, and a
   * regular table when it writes it bare (see hideShadowTables in
   * introspect.ts).
   */
  shadowTables?(args: Args): string[];

  /**
   * Statements that turn `current` into `target`. The caller drops views that
   * depend on the virtual table before these statements and recreates them
   * afterwards.
   *
   * Do not ALTER TABLE ... RENAME the virtual table here with the default
   * PRAGMA legacy_alter_table = OFF: SQLite then rewrites every view and
   * trigger body that references it to the new name, and triggers are not
   * dropped around a recreate. Carry data through a separate regular table.
   * A rename that only parks the table before dropping it (as FTS5 does for
   * contentless_unindexed) must run with legacy_alter_table = ON, which leaves
   * those bodies alone, and switch it back OFF afterwards; the driver puts the
   * connection's own setting back once the migration has run (see
   * preservingLegacyAlterTable in driver.ts).
   */
  recreate(ctx: VirtualTableRecreateContext<Args>): DDLStatement[];

  /**
   * `recreate` split in two: `drop` takes whatever data is carried out of the
   * current table and drops it, `create` creates the target table and puts
   * the data back. Used when a table or virtual table takes the name of one
   * of the current table's shadow tables in the same migration, or when
   * `dropFirst` says so: the drop then runs before any table or view
   * operation, and the create where the recreate would have run (after every
   * table operation). Omitted: the drop is `drop` (or DROP
   * TABLE) and the create is `create` (or the target's SQL), which carries no
   * data.
   */
  recreateSteps?(ctx: VirtualTableRecreateContext<Args>): {
    drop: DDLStatement[];
    create: DDLStatement[];
  };

  /**
   * Whether the drop step of this recreate (see `recreateSteps`) must run
   * before the migration changes any table or view: it reads the current
   * table's rows through the virtual table, which reads them from a relation
   * (e.g. an FTS5 content view) that later operations may drop. Requires
   * `recreateSteps`.
   */
  dropFirst?(ctx: VirtualTableRecreateContext<Args>): boolean;

  /**
   * Statements that create the virtual table. Defaults to the table's stored
   * SQL when omitted; a handler that adds statements must still create the
   * table with exactly `target.sql` so the next run sees no difference.
   */
  create?(target: VirtualTable, args: Args): DDLStatement[];

  /**
   * Statements that drop the virtual table. Defaults to DROP TABLE IF EXISTS
   * when omitted.
   */
  drop?(current: VirtualTable, args: Args): DDLStatement[];

  /** Statements that refresh the virtual table's contents without changing its structure */
  rebuild?(ctx: VirtualTableRebuildContext<Args>): DDLStatement[];

  /**
   * Called for each dependency of a desired virtual table that is recreated or
   * renamed by the same migration. Omit when the module has no dependencies.
   */
  onDependencyChanged?(ctx: VirtualTableDependencyContext<Args>): DependencyReaction;

  /** Warnings for an operation on a virtual table of this module */
  warnings(ctx: VirtualTableWarningContext<Args>): MigrationWarning[];
}
