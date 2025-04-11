import type { Column, Index, Table, Trigger, View } from "./introspection-result";

type OperationTarget = Table | Column | Index | Trigger | View;
type OperationType = "create" | "drop" | "rename" | "recreate" | "rewrite";
type Operation<O extends OperationType, T extends OperationTarget> = {
  type: O;
  current?: T;
  target?: T;
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
};

export type RewriteOperation = Operation<"rewrite", Table> & {
  current: Table;
  target: Table;
};

export type MigrationOperation =
  | CreateOperation<OperationTarget>
  | DropOperation<OperationTarget>
  | RenameOperation<OperationTarget>
  | RecreateOperation
  | RewriteOperation;
