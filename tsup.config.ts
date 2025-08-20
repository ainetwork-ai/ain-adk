import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/**/*.ts", "!src/**/*.test.ts"],
    format: "esm",
    outDir: "dist/esm",
    dts: true, // Generate .d.ts files only for the ESM build
    sourcemap: true,
    clean: true, // Clean the dist folder before building
    splitting: true,
    shims: true,
  },
  {
    entry: ["src/**/*.ts"],
    format: "cjs",
    outDir: "dist/cjs",
    sourcemap: true,
    splitting: true,
    shims: true,
  },
]);