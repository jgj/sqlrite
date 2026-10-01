import { basename, resolve } from "node:path";
import { glob } from "glob";
import type { MigrationOptions } from "../src/migration-statements";

export interface TestCase {
  filename: string;
  description: string;
  exclusive?: boolean;
  /** The case's schemas are equivalent: migrating must emit no statement at all */
  expectNoStatements?: boolean;
  current: string;
  next: string;
  /** Options passed to every migration of the case */
  options?: MigrationOptions;
}

export async function loadTestCases(): Promise<TestCase[]> {
  const testFiles = await glob("./test/test-cases/*.ts");

  const testCases: TestCase[] = [];

  for (const file of testFiles) {
    const module = await import(resolve(file));

    if (typeof module.description !== "string") {
      throw new Error(`Test case ${file} has a missing or invalid description`);
    }

    if (typeof module.current !== "string") {
      throw new Error(`Test case ${file} has a missing or invalid current`);
    }

    if (typeof module.next !== "string") {
      throw new Error(`Test case ${file} has a missing or invalid next`);
    }

    testCases.push({
      filename: basename(file),
      description: module.description,
      exclusive: module.exclusive,
      expectNoStatements: module.expectNoStatements === true,
      current: module.current,
      next: module.next,
      options: module.options,
    });
  }

  return testCases;
}
