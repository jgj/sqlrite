import { foldName } from "../utils";
import { splitModuleArgs, unquoteIdentifier } from "./parse";

// FTS3 and FTS4 have no module handler (they are recreated with DROP +
// CREATE), but introspection needs to know which of the shadow table names
// they reserve (%_content, %_segments, %_segdir, %_docsize, %_stat) a table
// actually created: SQLite classifies a user table named like one of them as a
// shadow table even when the virtual table has no such table, e.g. a table
// docs_content next to an external-content FTS4 table docs.
//
// Checked against SQLite (fts3.c, fts3InitVtab and fts3CreateTables):
// - FTS3 reads no options: it always creates %_content, %_segments and
//   %_segdir, and creates %_stat on demand (e.g. automerge=)
// - FTS4 always creates %_segments, %_segdir and %_stat; %_content unless a
//   content= option is given (external content, or contentless with an empty
//   value); %_docsize unless matchinfo=fts3
// - an FTS4 option is an argument holding '=', its name being the text before
//   the first '=' exactly as written (no surrounding whitespace), matched
//   case-insensitively; its value is dequoted

export type Fts3ShadowTables = {
  /** Suffixes of the shadow tables the virtual table has */
  created: string[];
  /** Suffixes of the shadow tables the virtual table may create later */
  onDemand: string[];
};

/**
 * The shadow tables an FTS3 or FTS4 table has with these arguments, or
 * undefined for any other module
 */
export function fts3ShadowTables(module: string, args: string): Fts3ShadowTables | undefined {
  const name = foldName(module);
  if (name === "fts3") {
    return { created: ["content", "segments", "segdir"], onDemand: ["stat"] };
  }
  if (name !== "fts4") return undefined;

  let content = true;
  let docsize = true;
  for (const arg of splitModuleArgs(args)) {
    const equals = arg.indexOf("=");
    if (equals === -1) continue;
    const option = foldName(arg.slice(0, equals));
    const value = unquoteIdentifier(arg.slice(equals + 1));
    if (option === "content") content = false;
    if (option === "matchinfo") docsize = foldName(value) !== "fts3";
  }

  return {
    created: [
      ...(content ? ["content"] : []),
      "segments",
      "segdir",
      ...(docsize ? ["docsize"] : []),
      "stat",
    ],
    onDemand: [],
  };
}
