import { expect } from "vitest";
import type { Driver } from "~/driver";

export type TestDriver = ReturnType<typeof getTestDriver>;
export type TestDriverContext = { case: string; client: string; statements: string[] };

export function getTestDriver(driver: Driver, context: TestDriverContext) {
  const selectOne = async <T>(sql: string) => (await driver.query<T>(sql)).at(0);
  const exists = async (sql: string) => (await driver.query(sql)).length > 0;

  const fmt = (msg: string) => `[${context.case}][${context.client}] ${msg}`;

  const ddl = {
    expectStatementCount(count: number) {
      expect(context.statements.length, `Has ${count} DDL statements`).toBe(count);
    },
    expectStatement(startingWith: string) {
      expect(
        context.statements.some((s) => s.startsWith(startingWith)),
        `Contains a statement starting with '${startingWith}'`,
      );
    },
    log() {
      console.log(context.statements);
    },
  } as const;

  return {
    ...driver,
    ddl,
    async tableExists(name: string) {
      expect(
        await exists(
          `select 1 as success from sqlite_schema where type = 'table' and name = '${name}'`,
        ),
        fmt(`Table '${name}' does not exist`),
      ).toBe(true);
    },
    async tableNotExists(name: string) {
      expect(
        await exists(
          `select 1 as success from sqlite_schema where type = 'table' and name = '${name}'`,
        ),
        fmt(`Table '${name}' still exists but should have been dropped`),
      ).toBe(false);
    },
    async tableHasColumn(table: string, column: string, dataType: string) {
      const result = await selectOne<{ type: string }>(
        `SELECT type FROM pragma_table_info('${table}') WHERE name = '${column}'`,
      );
      expect(
        result?.type.toUpperCase(),
        fmt(`Column '${column}' in table '${table}' has wrong type or doesn't exist`),
      ).toBe(dataType.toUpperCase());
    },
    async columnNotExists(table: string, column: string) {
      const result = await exists(
        `SELECT 1 FROM pragma_table_info('${table}') WHERE name = '${column}'`,
      );
      expect(
        result,
        fmt(`Column '${column}' still exists in table '${table}' but should have been dropped`),
      ).toBe(false);
    },
    async columnHasConstraint(table: string, column: string, constraint: string) {
      const info = await selectOne<{ [key: string]: number }>(
        `SELECT "${constraint}" FROM pragma_table_info('${table}') WHERE name = '${column}'`,
      );
      expect(
        info?.[constraint],
        fmt(`Column '${column}' in table '${table}' missing ${constraint} constraint`),
      ).toBe(1);
    },
    async indexExists(table: string, indexName: string) {
      expect(
        await exists(
          `SELECT 1 FROM sqlite_schema WHERE type = 'index' AND tbl_name = '${table}' AND name = '${indexName}'`,
        ),
        fmt(`Index '${indexName}' does not exist on table '${table}'`),
      ).toBe(true);
    },
    async foreignKeyExists(
      fromTable: string,
      fromColumn: string,
      toTable: string,
      toColumn = "id",
    ) {
      const fkInfo = await selectOne<{ id: number }>(
        `SELECT 1 FROM pragma_foreign_key_list('${fromTable}')
         WHERE "from" = '${fromColumn}' AND "table" = '${toTable}' AND "to" = '${toColumn}'`,
      );
      expect(
        fkInfo,
        fmt(`Foreign key from ${fromTable}.${fromColumn} to ${toTable}.${toColumn} does not exist`),
      ).toBeDefined();
    },
  };
}
