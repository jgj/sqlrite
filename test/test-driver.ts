import { expect } from "vitest";
import type { Driver } from "~/driver";

export type TestDriver = ReturnType<typeof getTestDriver>;

export function getTestDriver(driver: Driver) {
  // add helper functions for making assertions about the schema of the database
  return {
    ...driver,
    async tableExists(name: string) {
      // TODO
    },
  };
}
