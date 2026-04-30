import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    runtime: "src/runtime.ts",
    "bun/index": "src/bun/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  external: ["bun", "typescript", "ts-morph", "chokidar", "citty", "fast-glob"],
  banner: {
    js: "// mintz — TypeScript types you can read at runtime. https://github.com/<user>/mintz",
  },
});
