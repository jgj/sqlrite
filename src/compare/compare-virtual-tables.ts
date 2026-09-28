import type { VirtualTable } from "../introspection-result";
import { foldName, toMapBy } from "../utils";
import { sameModule, virtualTableDifferences } from "../virtual-tables/registry";
import type { Diff, Modified } from "./types";

/**
 * Virtual tables are compared by module and by the module handler's view of
 * the arguments, never by raw SQL: SQLite stores everything after the table
 * name verbatim, so cosmetically different but equivalent definitions must not
 * show up as modified. Names are matched like SQLite matches them, ignoring
 * the case of ASCII letters only: `Docs` and `docs` are the same table, and a
 * difference in case alone is not a change (ALTER TABLE ... RENAME rejects it,
 * and a DROP + CREATE would lose the table's data); `Ä` and `ä` are two tables.
 */
export function compareVirtualTables(
  current: VirtualTable[],
  desired: VirtualTable[],
): Diff<VirtualTable> {
  const key = (vt: VirtualTable) => foldName(vt.name);
  const curr = toMapBy(current, key);
  const next = toMapBy(desired, key);

  const added: VirtualTable[] = [];
  const removed: VirtualTable[] = [];
  const modified: Modified<VirtualTable>[] = [];

  for (const vt of desired) {
    const existing = curr.get(key(vt));
    if (!existing) {
      added.push(vt);
      continue;
    }

    if (virtualTableDifferences(existing, vt).length > 0) {
      modified.push({
        current: existing,
        desired: vt,
        changes: sameModule(existing, vt) ? ["args"] : ["module"],
      });
    }
  }

  for (const vt of current) {
    if (!next.has(key(vt))) {
      removed.push(vt);
    }
  }

  return { added, removed, modified };
}
