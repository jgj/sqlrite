import type { IntrospectionObject, IntrospectionObjectType } from "~/introspection-result";

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
export type SchemaDiff = Record<IntrospectionObjectType, Diff<any>>;
