import { defineConfig } from "bunup";

export default defineConfig({
  entry: ["src/runtime.ts", "src/bun/index.ts", "src/cli/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node",
  dts: true,
  clean: true,
  sourcemap: "linked",
  splitting: false,
  external: ["bun", "typescript", "ts-morph", "@crustjs/core", "@crustjs/plugins"],
  banner: "// mintz — TypeScript types you can read at runtime. https://github.com/<user>/mintz",
});
