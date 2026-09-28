import type { VirtualTable } from "../introspection-result";
import type { RecreateReason, VirtualTableRecreateOperation } from "../migration-operation";
import { foldName } from "../utils";
import { defaultModule } from "./default";
import { fts5Module } from "./fts5";
import type { VirtualTableModule } from "./types";

// Module handlers keyed by lowercase module name. SQLite matches module names
// case-insensitively (`USING FTS5` and `USING fts5` are the same module).
const modules = new Map<string, VirtualTableModule<unknown>>();

export function registerVirtualTableModule<Args>(module: VirtualTableModule<Args>): void {
  modules.set(foldName(module.name), module);
}

// Built-in handlers
registerVirtualTableModule(fts5Module);

/** The handler registered for a module, or the default handler when there is none */
export function getVirtualTableModule(moduleName: string): VirtualTableModule<unknown> {
  return modules.get(foldName(moduleName)) ?? defaultModule;
}

export function sameModule(a: VirtualTable, b: VirtualTable): boolean {
  return foldName(a.module) === foldName(b.module);
}

/** The handler for a virtual table together with its parsed arguments */
export function resolveVirtualTable(vt: VirtualTable) {
  const handler = getVirtualTableModule(vt.module);
  return { handler, args: handler.parseArgs(vt.args) };
}

/**
 * Reasons `current` must be recreated to become `desired`; [] when they are
 * equivalent. Names are not compared, so this also serves rename detection.
 */
export function virtualTableDifferences(
  current: VirtualTable,
  desired: VirtualTable,
): RecreateReason[] {
  if (!sameModule(current, desired)) {
    return [
      {
        check: "virtual_table.module",
        detail: `Module changed: ${current.module} → ${desired.module}`,
      },
    ];
  }
  const handler = getVirtualTableModule(desired.module);
  return handler.diff(handler.parseArgs(current.args), handler.parseArgs(desired.args));
}

/**
 * The handler whose `recreate` carries out a recreate. A handler's `recreate`
 * assumes both sides use its module, so it is only called when the module is
 * unchanged. The callers (generate-ddl's recreateVirtualTableDDL and the
 * migration warnings) handle a module change themselves before getting here:
 * the current module's handler drops the table (`drop`) and the new module's
 * handler creates it (`create`), each with its own warnings. Should a module
 * change reach this function anyway, the default handler is returned, as its
 * `recreate` makes no assumption about either module.
 */
export function getRecreateModule(op: VirtualTableRecreateOperation): VirtualTableModule<unknown> {
  return sameModule(op.current, op.target)
    ? getVirtualTableModule(op.target.module)
    : defaultModule;
}
