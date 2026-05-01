import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRewrite } from "../../src/cli/rewrite";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function fixture(userSource: string): { root: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), "mintz-cli-"));
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

describe("runRewrite", () => {
  test("rewrites a state-1 file to state-2 (committed wrapper form)", async () => {
    const { root, entry } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">();', ""].join("\n"),
    );
    const code = await runRewrite({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).toBe(0);
    const after = readFileSync(entry, "utf8");
    expect(after).toContain('mint<"a" | "b">(["a", "b"])');
    expect(after).not.toContain('mint<"a" | "b">()');
  });

  test("idempotent: re-running on already-codegen'd source does nothing", async () => {
    const { root, entry } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">(["a", "b"]);', ""].join("\n"),
    );
    const before = readFileSync(entry, "utf8");
    const code = await runRewrite({
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

  test("dry-run does not write but reports", async () => {
    const { root, entry } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a">();', ""].join("\n"),
    );
    const before = readFileSync(entry, "utf8");
    const code = await runRewrite({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: true,
    });
    expect(code).toBe(0);
    expect(readFileSync(entry, "utf8")).toBe(before);
  });

  test("non-zero exit when one file errors but writes the rest", async () => {
    const { root } = fixture("");
    writeFileSync(
      join(root, "src", "ok.ts"),
      ['import mint from "mintz";', 'export const a = mint<"a">();', ""].join("\n"),
    );
    writeFileSync(
      join(root, "src", "bad.ts"),
      ['import mint from "mintz";', "export const b = mint<string>();", ""].join("\n"),
    );
    const code = await runRewrite({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).not.toBe(0);
    expect(readFileSync(join(root, "src", "ok.ts"), "utf8")).toContain('mint<"a">(["a"])');
  });
});
