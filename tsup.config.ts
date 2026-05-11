import { defineConfig } from "tsup";

const entry = ["src/**/*.ts", "!src/**/*.test.ts"];

export default defineConfig([
  {
    entry,
    format: "esm",
    outDir: "dist/esm",
    dts: true, // Generate .d.ts files only for the ESM build
    sourcemap: true,
    clean: ["dist/esm", "dist/cjs"], // Clean both output folders before building
    splitting: true,
    shims: true,
  },
  {
    entry,
    format: "cjs",
    outDir: "dist/cjs",
    sourcemap: true,
    splitting: true,
    shims: true,
  },
]);
