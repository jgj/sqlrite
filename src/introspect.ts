import type { Driver } from "./driver";
import { parseIntrospectionResult } from "./introspection-result";
import type { Column, IntrospectionResult, Table } from "./introspection-result";
import { type UnloadedModuleShadows, rememberHiddenTables } from "./unloaded-modules";
import { findViewsDependingOnTable, foldName } from "./utils";
import { fts3ShadowTables } from "./virtual-tables/fts3";
import { resolveVirtualTable } from "./virtual-tables/registry";

// base_tables holds the regular tables and the shadow tables; every section
// that calls a table pragma is driven from it. Shadow tables are removed in
// TypeScript (hideShadowTables), once it is known which of them a virtual
// table actually owns.
//
// - pragma_table_list classifies each object as table/view/virtual/shadow.
//   The older string filters (sql not like 'CREATE VIRTUAL TABLE%' / 'CREATE
//   TABLE ''%') missed R*Tree shadow tables and the shadow tables of any
//   renamed FTS/R*Tree table (SQLite writes those with double-quoted names),
//   and hid user tables whose name was written in single quotes.
// - 'shadow' only means the name matches one the virtual table's module
//   reserves (xShadowName); a user table such as docs_content next to an
//   external-content FTS5 table docs is classified 'shadow' too.
// - sqlite_schema, sqlite_sequence and sqlite_stat* are type 'table' in
//   pragma_table_list, hence the sqlite_% filter.
// - The CREATE VIRTUAL TABLE filter is a second guard for a virtual table
//   whose module is not loaded on this connection; pragma_table_list is not
//   guaranteed to classify it.
// - The table-valued pragmas are given the 'main' schema: with a bare name
//   they read a temp table of the same name instead of the main one.
// - pragma_table_info/xinfo raise "no such module" for a virtual table whose
//   module is not loaded, which would abort the whole query. The CTE is
//   MATERIALIZED and the pragmas are joined onto it, so only names that
//   passed the filters are ever handed to them, whatever order the planner
//   picks.
// - pragma_table_list returns rows in hash order; ord (the sqlite_schema
//   rowid, i.e. creation order) keeps the output order stable.
const introspectionSql = /* sql */ `
with base_tables as materialized (
  select
    sch.rowid as ord,
    sch.name as name,
    sch.sql as sql
  from
    pragma_table_list tl
    join sqlite_schema sch on sch.name = tl.name and sch.type = 'table'
  where
    tl.schema = 'main'
  and
    tl.type in ('table', 'shadow')
  and
    tl.name not like 'sqlite_%'
  and
    sch.sql not like 'CREATE VIRTUAL TABLE%'
)
select
  json_object(
    'tables',
    (
      select
        json_group_array(
          json_object(
            'type', 'table',
            'name', bt.name,
            'sql', bt.sql ,
            'views', json_array(),
            'num_cols', (select count(*) from pragma_table_info(bt.name, 'main'))
          )
          order by bt.ord
        )
      from
        base_tables bt
    ),
    'columns',
    (
      select
        json_group_array(
          json_object(
            'type',
            'column',
            'table',
            bt.name,
            'name',
            p.name,
            'data_type',
            case
              when instr(lower(p.type), '(') > 0 then substr(lower(p.type), 1, instr(lower(p.type), '(') - 1)
              else lower(p.type)
            end,
            'ordinal_position',
            p.cid,
            'nullable',
            (
              case
                when p."notnull" = 0 AND NOT (EXISTS(SELECT 1 FROM pragma_table_xinfo(bt.name, 'main') WHERE pk > 0 AND name = p.name)) then 'true'
                else 'false'
              end
            ),
            'character_maximum_length',
            case
              when lower(p.type) like 'char%'
              or lower(p.type) like 'nvarchar%'
              or lower(p.type) like 'varchar%' then case
                when instr(p.type, '(') > 0 then replace(
                  substr(
                    p.type,
                    instr(p.type, '(') + 1,
                    length(p.type) - instr(p.type, '(') - 1
                  ),
                  ')',
                  ''
                )
                else 'null'
              end
              else 'null'
            end,
            'precision',
            case
              when lower(p.type) like 'decimal%'
              or lower(p.type) like 'numeric%' then case
                when instr(p.type, '(') > 0 then json_object(
                  'precision',
                  substr(
                    p.type,
                    instr(p.type, '(') + 1,
                    instr(p.type, ',') - instr(p.type, '(') - 1
                  ),
                  'scale',
                  substr(
                    p.type,
                    instr(p.type, ',') + 1,
                    instr(p.type, ')') - instr(p.type, ',') - 1
                  )
                )
                else 'null'
              end
              else 'null'
            end,
            'default',
            coalesce(p.dflt_value, ''),
            'check_constraint',
            null,
            'autoincrement',
            'false',
            'generated',
            case p.hidden
              when 2 then 'virtual'
              when 3 then 'stored'
              else 'none'
            end
          )
          order by bt.ord, p.cid
        )
      from
        base_tables bt
        join pragma_table_xinfo (bt.name, 'main') p on p.hidden != 1
    ),
    'indices',
    (
      select json_group_array(
        json_object(
          'type', 'index',
          'name', idx.name,
          'table', bt.name,
          'columns', (
            select json_group_array(coalesce(ic.name, '__expr__' || ic.seqno))
            from pragma_index_info(idx.name, 'main') ic
            order by ic.seqno
          ),
          'unique', (
            case
              when idx."unique" = 1 then 'true'
              else 'false'
            end
          ),
          'sql', i.sql
        )
        order by bt.ord, idx.seq
      )
      from base_tables bt
      join pragma_index_list(bt.name, 'main') idx
      join sqlite_schema i on i.name = idx.name and i.type = 'index'
    ),
    'foreign_keys',
    (
      select
        json_group_array(
          json_object(
            'type',
            'foreign_key',
            'table',
            fk_grouped.table_name,
            'column',
            fk_grouped.from_cols,
            'name',
            'fk_' || fk_grouped.table_name || '_' || fk_grouped.from_cols || '_' || fk_grouped.ref_table || '_' || fk_grouped.to_cols,
            'referenced_table',
            fk_grouped.ref_table,
            'referenced_column',
            fk_grouped.to_cols,
            'on_update',
            fk_grouped.on_update,
            'on_delete',
            fk_grouped.on_delete,
            'definition',
            'FOREIGN KEY (' || fk_grouped.from_cols || ') REFERENCES ' || fk_grouped.ref_table || '(' || fk_grouped.to_cols || ') ON UPDATE ' || fk_grouped.on_update || ' ON DELETE ' || fk_grouped.on_delete
          )
        )
      from
        (
          select
            bt.name as table_name,
            fk.id as fk_id,
            group_concat(fk."from") as from_cols,
            fk."table" as ref_table,
            group_concat(fk."to") as to_cols,
            fk.on_update,
            fk.on_delete
          from
            base_tables bt
            join pragma_foreign_key_list(bt.name, 'main') fk
          group by
            bt.name, fk.id
        ) fk_grouped
    ),
    'primary_keys',
    (
      select
        json_group_array(
          json_object(
            'type',
            'primary_key',
            'table',
            pk.table_name,
            'field_count',
            pk.field_count,
            'column',
            pk.pk_column,
            'definition',
            'PRIMARY KEY (' || pk.pk_column || ')'
          )
        )
      from
        (
          select
            bt.name as table_name,
            count(p.name) as field_count, -- Count of primary key columns
            group_concat(p.name) as pk_column -- Concatenated list of primary key columns
          from
            base_tables bt
            join pragma_table_info (bt.name, 'main') p on p.pk > 0
          group by
            bt.name
        ) pk
    ),
    'triggers',
    (
      select
        json_group_array(
          json_object(
            'type',
            'trigger',
            'name',
            sch.name,
            'table',
            sch.tbl_name,
            'sql',
            sch.sql
          )
        )
      from
        sqlite_schema sch
      where
        sch.type = 'trigger'
    ),
    'views',
    (
      select
        json_group_array(json_object('type', 'view', 'name', sch.name, 'sql', sch.sql, 'tables', json_array()))
      from
        sqlite_schema sch
      where
        sch.type = 'view'
    ),
    'virtual_tables',
    (
      -- Read from sqlite_schema rather than pragma_table_list so a virtual table
      -- whose module is not loaded on this connection is still reported.
      -- SQLite always stores the statement prefix as 'CREATE VIRTUAL TABLE '.
      -- module and args are parsed from sql in TypeScript.
      select
        json_group_array(
          json_object('type', 'virtual_table', 'name', sch.name, 'sql', sch.sql)
          order by sch.rowid
        )
      from
        sqlite_schema sch
      where
        sch.type = 'table'
      and
        sch.sql like 'CREATE VIRTUAL TABLE%'
    )
  ) as "schema"`;

export async function introspect(driver: Driver) {
  const results = await driver.query<{ schema: string }>(introspectionSql);
  const row = results[0];
  if (!row) {
    throw new Error("Introspection query returned no results");
  }
  const base = hideShadowTables(
    parseIntrospectionResult(row.schema),
    await getShadowTableNames(driver),
  );
  const loadedModules = await getLoadedModules(driver);
  const { schema, hidden } = hideUnloadedModuleShadows(base, loadedModules, new Set());

  const ir = linkObjects(schema);
  if (hidden.length > 0) {
    // Kept for revealDeclaredTables, which runs once the desired schema is known
    const unlinked = structuredClone(base);
    rememberHiddenTables(ir, (keep) => {
      const result = hideUnloadedModuleShadows(structuredClone(unlinked), loadedModules, keep);
      return { schema: linkObjects(result.schema), hidden: result.hidden };
    });
  }
  return ir;
}

// Resolve the dependencies between objects, and column details that are
// parsed from the table SQL
function linkObjects(ir: IntrospectionResult): IntrospectionResult {
  for (const table of ir.tables) {
    table.views = findViewsDependingOnTable(table, ir.views);

    // Process check constraints for all columns in this table
    processColumns(table, ir.columns);
  }

  const virtualTableViews = new Map(
    ir.virtual_tables.map((vt) => [vt.name, findViewsDependingOnTable(vt, ir.views)]),
  );

  for (const view of ir.views) {
    view.tables = [
      ...ir.tables.filter((t) => t.views.includes(view.name)).map((t) => t.name),
      ...ir.virtual_tables
        .filter((vt) => virtualTableViews.get(vt.name)?.includes(view.name))
        .map((vt) => vt.name),
    ];
  }

  return ir;
}

/**
 * Lowercase names of the virtual table modules registered on the connection,
 * or null when they cannot be listed (pragma_module_list can be compiled out
 * with SQLITE_OMIT_INTROSPECTION_PRAGMAS).
 */
async function getLoadedModules(driver: Driver): Promise<Set<string> | null> {
  try {
    const rows = await driver.query<{ name: unknown }>("select name from pragma_module_list");
    const names = rows.map((r) => r.name).filter((n): n is string => typeof n === "string");
    return names.length > 0 ? new Set(names.map(foldName)) : null;
  } catch {
    return null;
  }
}

/** Names of the tables pragma_table_list classifies as shadow tables */
async function getShadowTableNames(driver: Driver): Promise<string[]> {
  const rows = await driver.query<{ name: unknown }>(
    "select name from pragma_table_list where schema = 'main' and type = 'shadow'",
  );
  return rows.map((r) => r.name).filter((n): n is string => typeof n === "string");
}

/**
 * Remove the shadow tables that a virtual table owns. SQLite classifies a
 * table as a shadow table of the virtual table named like its prefix (up to
 * the last '_') whenever that virtual table's module reserves the suffix,
 * whether or not the virtual table created it. A module handler that knows
 * which shadow tables its virtual table creates (shadowTables) decides, and so
 * does what is known of FTS3/FTS4 (see fts3ShadowTables).
 *
 * Otherwise (R*Tree, extension modules, ...), and for a shadow table FTS3
 * creates on demand, the table's stored SQL decides: modules create their
 * shadow tables with a quoted name (FTS3/FTS4 write `CREATE TABLE
 * 'x_content'(...)`, R*Tree and most extensions `CREATE TABLE "x_node"(...)`,
 * and a rename rewrites the name double-quoted), whereas a user table named
 * like a shadow table the virtual table does not create is usually written
 * with a bare name. These modules create every shadow table they reserve, as
 * far as is known, so such a user table cannot exist next to them anyway.
 */
function hideShadowTables(ir: IntrospectionResult, shadowNames: string[]): IntrospectionResult {
  const virtualTables = new Map(ir.virtual_tables.map((vt) => [foldName(vt.name), vt]));
  const tableSql = new Map(ir.tables.map((t) => [foldName(t.name), t.sql]));
  const owned = (name: string) => {
    const split = name.lastIndexOf("_");
    const vt = virtualTables.get(foldName(name.slice(0, split)));
    if (split <= 0 || !vt) return true;
    const suffix = foldName(name.slice(split + 1));
    const { handler, args } = resolveVirtualTable(vt);
    if (handler.shadowTables) return handler.shadowTables(args).includes(suffix);
    const fts3 = fts3ShadowTables(vt.module, vt.args);
    if (fts3?.created.includes(suffix)) return true;
    if (fts3 && !fts3.onDemand.includes(suffix)) return false;
    return /^CREATE\s+TABLE\s+['"]/i.test(tableSql.get(foldName(name)) ?? "'");
  };

  const hidden = new Set(shadowNames.filter(owned).map(foldName));
  if (hidden.size === 0) return ir;
  return withoutTables(ir, (table) => hidden.has(foldName(table)));
}

function withoutTables(
  ir: IntrospectionResult,
  hide: (table: string) => boolean,
): IntrospectionResult {
  return {
    ...ir,
    tables: ir.tables.filter((t) => !hide(t.name)),
    columns: ir.columns.filter((c) => !hide(c.table)),
    indices: ir.indices.filter((i) => !hide(i.table)),
    foreign_keys: ir.foreign_keys.filter((fk) => !hide(fk.table)),
    primary_keys: ir.primary_keys.filter((pk) => !hide(pk.table)),
  };
}

/**
 * pragma_table_list recognizes shadow tables through the module's xShadowName
 * callback, so the shadow tables of a module that is not loaded on this
 * connection (e.g. sqlite-vec's vec0 when the caller did not load the
 * extension on the live client) are reported as ordinary tables. Treating them
 * as user tables would let a migration drop or recreate them and break the
 * virtual table. SQLite offers no reliable way to tell them apart, so as a
 * heuristic a table named `<virtual table>_<anything>` is treated as a shadow
 * table when that virtual table's module is not loaded, unless its name is in
 * `keep` (a table the desired schema declares as a regular table, which
 * therefore cannot be a shadow table there).
 *
 * This can still hide a genuine user table that shares the prefix and that
 * the desired schema does not declare under that name (for instance one
 * being renamed). It is then left alone, and the tables hidden are returned
 * so the caller can report them.
 */
function hideUnloadedModuleShadows(
  ir: IntrospectionResult,
  loadedModules: Set<string> | null,
  keep: ReadonlySet<string>,
): { schema: IntrospectionResult; hidden: UnloadedModuleShadows[] } {
  if (!loadedModules) return { schema: ir, hidden: [] };

  const unloaded = ir.virtual_tables
    .filter((vt) => !loadedModules.has(foldName(vt.module)))
    .map((vt) => ({ vt, prefix: `${foldName(vt.name)}_` }));
  if (unloaded.length === 0) return { schema: ir, hidden: [] };

  const owner = (table: string) => {
    const name = foldName(table);
    if (keep.has(name)) return undefined;
    return unloaded.find(({ prefix }) => name.startsWith(prefix))?.vt;
  };

  const hidden = unloaded
    .map(({ vt }) => ({
      virtualTable: vt.name,
      module: vt.module,
      tables: ir.tables.filter((t) => owner(t.name) === vt).map((t) => t.name),
    }))
    .filter((h) => h.tables.length > 0);

  return { schema: withoutTables(ir, (table) => owner(table) !== undefined), hidden };
}

/**
 * Extract check constraints and AUTO_INCREMENT for each column in a table by parsing the table's SQL
 */

function processColumns(table: Table, columns: Column[]) {
  if (!table.sql) return;

  const columnsInTable = columns.filter((col) => col.table === table.name);

  // For each column in the table, look for check constraints and AUTOINCREMENT
  for (const column of columnsInTable) {
    // Check for AUTOINCREMENT on primary key columns
    // The regex needs to be flexible with spacing and ordering of PRIMARY KEY AUTOINCREMENT
    column.autoincrement = Boolean(
      table.sql.match(
        new RegExp(`${column.name}\\s+INTEGER\\s+PRIMARY\\s+KEY\\s+AUTOINCREMENT`, "i"),
      ),
    );

    // First, extract the column definition section for CHECK constraint
    const columnDefPattern = new RegExp(
      `${column.name}\\s+\\w+(?:\\s*\\([^)]*\\))?(?:\\s+\\w+)*?\\s+CHECK\\s*\\(`,
      "i",
    );

    const startMatch = columnDefPattern.exec(table.sql);
    if (!startMatch) continue;

    // Find the start position of the CHECK constraint content
    const startPos = startMatch.index + startMatch[0].length;
    let endPos = startPos;
    let openParens = 1; // We've already encountered one open parenthesis

    // Scan through the string to find the matching closing parenthesis
    while (endPos < table.sql.length && openParens > 0) {
      if (table.sql[endPos] === "(") openParens++;
      else if (table.sql[endPos] === ")") openParens--;
      endPos++;
    }

    if (openParens === 0) {
      // We found the matching closing parenthesis
      const checkContent = table.sql.substring(startPos, endPos - 1); // -1 to exclude the closing parenthesis
      column.check_constraint = `CHECK (${checkContent})`;
    }
  }
}
