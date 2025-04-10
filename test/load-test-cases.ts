import { glob } from "glob";
import path from "node:path";
import type { Driver } from "~/driver";

export interface TestCase {
  filename: string;
  description: string;
  current: string;
  next: string;
  verify: (driver: Driver) => Promise<void>;
}

export async function loadTestCases(): Promise<TestCase[]> {
  const testFiles = await glob("./test/test-cases/*.ts");

  const testCases: TestCase[] = [];

  for (const file of testFiles) {
    const module = await import(path.resolve(file));

    if (typeof module.description !== "string") {
      throw new Error(`Test case ${file} has a missing or invalid description`);
    }

    if (typeof module.current !== "string") {
      throw new Error(`Test case ${file} has a missing or invalid current`);
    }

    if (typeof module.next !== "string") {
      throw new Error(`Test case ${file} has a missing or invalid next`);
    }

    if (typeof module.verify !== "function") {
      throw new Error(`Test case ${file} has a missing or invalid verify`);
    }

    testCases.push({
      filename: file,
      description: module.description,
      current: module.current,
      next: module.next,
      verify: module.verify,
    });
  }

  return testCases;
}
