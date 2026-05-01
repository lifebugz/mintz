import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../../src/cli/check";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function fixture(userSource: string): { root: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), "mintz-check-"));
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
  writeFileSync(entry, userSource);
  return { root, entry };
}

describe("runCheck", () => {
  test("returns 0 when source is in sync with type", async () => {
    const { root, entry } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">(["a", "b"]);', ""].join("\n"),
    );
    const before = readFileSync(entry, "utf8");
    const code = await runCheck({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).toBe(0);
    expect(readFileSync(entry, "utf8")).toBe(before);
  });

  test("returns non-zero on drift (stale array)", async () => {
    const { root } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">(["a"]);', ""].join("\n"),
    );
    const code = await runCheck({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).not.toBe(0);
  });

  test("returns non-zero on un-codegen'd source (state 1)", async () => {
    const { root } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">();', ""].join("\n"),
    );
    const code = await runCheck({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).not.toBe(0);
  });
});
