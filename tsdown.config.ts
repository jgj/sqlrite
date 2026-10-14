import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/drizzle.ts"],
  format: "esm",
  platform: "node",
  dts: true,
  clean: true,
  // Drop unused imports of the driver packages (left behind by type-only
  // imports), so the declarations do not import drivers a consumer may lack
  treeshake: { moduleSideEffects: "no-external" },
});
