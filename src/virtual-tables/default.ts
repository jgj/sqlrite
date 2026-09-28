import { normalizeSql } from "../compare/normalize-sql";
import type { MigrationWarning } from "../migration-statements";
import { ensureSemicolon, sqlIdentifier as sql } from "../utils";
import type { VirtualTableModule } from "./types";

/**
 * Handler for every module without a dedicated one (rtree, fts4, extension
 * modules such as vec0, ...). It knows nothing about the module, so:
 * - arguments are compared as text after normalizing identifier quoting and
 *   whitespace; any other difference is a change
 * - renames are carried out as DROP + CREATE
 * - a recreate is DROP + CREATE, which loses the data in the virtual table
 */
export const defaultModule: VirtualTableModule<string> = {
  name: "default",

  parseArgs(args) {
    return normalizeSql(args);
  },

  diff(current, desired) {
    if (current === desired) return [];
    return [
      {
        check: "virtual_table.args",
        detail: `Module arguments changed: (${current}) → (${desired})`,
      },
    ];
  },

  supportsRename: false,

  dependencies() {
    return [];
  },

  recreate({ current, target }) {
    return [`DROP TABLE IF EXISTS ${sql(current.name)};`, ensureSemicolon(target.sql)];
  },

  warnings({ op }) {
    const warnings: MigrationWarning[] = [];
    if (op.type === "drop") {
      warnings.push({
        type: "destructive",
        message: `Virtual table "${op.current.name}" will be dropped. Data in virtual table "${op.current.name}" will be lost.`,
      });
    } else if (op.type === "recreate") {
      warnings.push({
        type: "destructive",
        message: `Virtual table "${op.target.name}" (module ${op.target.module}) will be recreated with DROP + CREATE. Data in virtual table "${op.current.name}" will be lost.`,
      });
    }
    return warnings;
  },
};
