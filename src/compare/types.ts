import type {
  Column,
  ForeignKey,
  Index,
  IntrospectionObject,
  IntrospectionObjectType,
  PrimaryKey,
  Table,
  Trigger,
  View,
} from "~/introspection-result";

export type Modified<T extends IntrospectionObject> = {
  current: T;
  desired: T;
  changes: (keyof T)[];
};

export type Diff<T extends IntrospectionObject> = {
  added: T[];
  removed: T[];
  modified: Modified<T>[];
};

// biome-ignore lint/suspicious/noExplicitAny: no you're suspicious
export interface SchemaDiff extends Record<IntrospectionObjectType, Diff<any>> {
  table: Diff<Table>;
  column: Diff<Column>;
  index: Diff<Index>;
  foreign_key: Diff<ForeignKey>;
  primary_key: Diff<PrimaryKey>;
  trigger: Diff<Trigger>;
  view: Diff<View>;
}
