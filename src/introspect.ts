import type { Driver } from "./driver";
import { parseIntrospectionResult } from "./introspection-result";
import type { Column, Table } from "./introspection-result";
import { findViewsDependingOnTable } from "./utils";

const introspectionSql = /* sql */ `
select
  json_object(
    'tables',
    (
      select
        json_group_array(
          json_object(
            'type', 'table',
            'name', sch.name,
            'sql', sch.sql ,
            'views', json_array(),
            'num_cols', (select count(*) from pragma_table_info(sch.name))
          )
        )
      from
        sqlite_schema sch
      where
        sch.type = 'table'
      and
        sch.name not like 'sqlite_%'
    ),
    'columns',
    (
      select
        json_group_array(
          json_object(
            'type',
            'column',
            'table',
            sch.name,
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
                when p."notnull" = 0 AND NOT (EXISTS(SELECT 1 FROM pragma_table_info(sch.name) WHERE pk > 0 AND name = p.name)) then 'true'
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
            'false'
          )
        )
      from
        sqlite_schema sch
        join pragma_table_info (sch.name) p on sch.type = 'table'
      where
        sch.name not like 'sqlite_%'
    ),
    'indices',
    (
      select json_group_array(
        json_object(
          'type', 'index',
          'name', idx.name,
          'table', sch.name,
          'columns', (
            select json_group_array(ic.name)
            from pragma_index_info(idx.name) ic
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
      )
      from sqlite_schema sch
      join pragma_index_list(sch.name) idx on sch.type = 'table'
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
            sch.name,
            'column',
            fk."from",
            'name',
            'fk_' || sch.name || '_' || fk."from" || '_' || fk."table" || '_' || fk."to", -- Generated foreign key name
            'referenced_table',
            fk."table",
            'referenced_column',
            fk."to",
            'on_update',
            fk.on_update,
            'on_delete',
            fk.on_delete,
            'definition',
            'FOREIGN KEY (' || fk."from" || ') REFERENCES ' || fk."table" || '(' || fk."to" || ')' || ' ON UPDATE ' || fk.on_update || ' ON DELETE ' || fk.on_delete
          )
        )
      from
        sqlite_schema sch
        join pragma_foreign_key_list (sch.name) fk on sch.type = 'table'
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
            sch.name as table_name,
            count(p.name) as field_count, -- Count of primary key columns
            group_concat(p.name) as pk_column -- Concatenated list of primary key columns
          from
            sqlite_schema sch
            join pragma_table_info (sch.name) p on sch.type = 'table'
            and p.pk > 0
          group by
            sch.name
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
    )
  ) as "schema"`;

export async function introspect(driver: Driver) {
  const results = await driver.query<{ schema: string }>(introspectionSql);
  const ir = parseIntrospectionResult(results[0].schema);

  for (const table of ir.tables) {
    table.views = findViewsDependingOnTable(table, ir.views);

    // Process check constraints for all columns in this table
    processColumns(table, ir.columns);
  }

  for (const view of ir.views) {
    view.tables = ir.tables.filter((t) => t.views.includes(view.name)).map((t) => t.name);
  }

  return ir;
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
