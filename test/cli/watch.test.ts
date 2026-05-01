import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWatch } from "../../src/cli/watch";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("runWatch", () => {
  test(
    "rewrites once on start, then again when source changes",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mintz-watch-"));
      dirs.push(root);
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            paths: { mintz: [join(import.meta.dir, "..", "..", "src", "runtime.ts")] },
          },
          include: ["src/**/*"],
        }),
      );
      const entry = join(root, "src", "user.ts");
      writeFileSync(
        entry,
        ['import mint from "mintz";', 'export const x = mint<"a">();'].join("\n"),
      );

      const watcher = runWatch({
        cwd: root,
        paths: [],
        tsconfig: join(root, "tsconfig.json"),
        json: false,
        silent: true,
        dryRun: false,
      });

      await new Promise((r) => setTimeout(r, 300));
      expect(readFileSync(entry, "utf8")).toContain('mint<"a">(["a"])');

      writeFileSync(
        entry,
        ['import mint from "mintz";', 'export const x = mint<"a" | "b">();'].join("\n"),
      );
      await new Promise((r) => setTimeout(r, 600));
      expect(readFileSync(entry, "utf8")).toContain('mint<"a" | "b">(["a", "b"])');

      await watcher.stop();
    },
    { timeout: 5000 },
  );
});
