import type { Column, Index, Table, Trigger, View, VirtualTable } from "./introspection-result";
import { foldName } from "./utils";

type OperationTarget = Table | Column | Index | Trigger | View | VirtualTable;
type OperationType = "create" | "drop" | "rename" | "recreate" | "rebuild";
type Operation<O extends OperationType, T extends OperationTarget> = {
  type: O;
  current?: T;
  target?: T;
};

export type RecreateReason = {
  check: string;
  detail: string;
};

export type CreateOperation<T extends OperationTarget> = Operation<"create", T> & {
  target: T;
};

export type DropOperation<T extends OperationTarget> = Operation<"drop", T> & {
  current: T;
};

export type RenameOperation<T extends OperationTarget> = Operation<"rename", T> & {
  current: T;
  target: T;
};

export type RecreateOperation = Operation<"recreate", Table> & {
  current: Table;
  target: Table;
  reasons?: RecreateReason[];
  /**
   * Columns renamed by the renameColumns option. The recreate copies each
   * one's data from its current name to its new name; every other column is
   * copied only to the column of the same name.
   */
  columnRenames?: ColumnRename[];
};

export type ColumnRename = { from: string; to: string };

// How the virtual table is recreated (and whether its data survives) is up to
// the module handler; see src/virtual-tables/types.ts.
export type VirtualTableRecreateOperation = Operation<"recreate", VirtualTable> & {
  current: VirtualTable;
  target: VirtualTable;
  reasons: RecreateReason[];
  /**
   * Set when the recreate is carried out in two operations: "drop" (take the
   * data out and drop the current table) runs before any other operation,
   * because a create or rename takes the name of a current shadow table, or
   * because the data is read through a relation later operations change (see
   * VirtualTableModule.dropFirst); "create" (create the table and put the
   * data back) runs where a recreate normally does. Unset: both steps in one
   * operation.
   */
  step?: "drop" | "create";
};

// The virtual table's structure is unchanged but its contents must be
// refreshed, e.g. an external-content FTS index after its content table was
// recreated.
export type RebuildOperation = Operation<"rebuild", VirtualTable> & {
  target: VirtualTable;
  reasons: RecreateReason[];
};

export type VirtualTableOperation =
  | CreateOperation<VirtualTable>
  | DropOperation<VirtualTable>
  | RenameOperation<VirtualTable>
  | VirtualTableRecreateOperation
  | RebuildOperation;

export type MigrationOperation =
  | CreateOperation<OperationTarget>
  | DropOperation<OperationTarget>
  | RenameOperation<OperationTarget>
  | RecreateOperation
  | VirtualTableRecreateOperation
  | RebuildOperation;

export function isVirtualTableOperation(op: MigrationOperation): op is VirtualTableOperation {
  return (op.current ?? op.target)?.type === "virtual_table";
}

/**
 * The regular tables renamed by these operations: the final name by the
 * current name (folded by foldName), following renames through a temporary
 * name (see orderRenames in migration-plan.ts)
 */
export function getTableRenameMap(operations: readonly MigrationOperation[]): Map<string, string> {
  const renamed = new Map<string, string>();
  for (const op of operations) {
    if (op.type !== "rename" || op.current?.type !== "table" || !op.target) continue;
    const from = foldName(op.current.name);
    const original = [...renamed].find(([, name]) => foldName(name) === from)?.[0] ?? from;
    renamed.set(original, op.target.name);
  }
  return renamed;
}
