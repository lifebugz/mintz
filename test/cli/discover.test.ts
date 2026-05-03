import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFiles } from "../../src/cli/discover";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "mintz-discover-"));
  dirs.push(root);
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "// a");
  writeFileSync(join(root, "src", "b.tsx"), "// b");
  writeFileSync(join(root, "src", "c.mts"), "// c");
  writeFileSync(join(root, "src", "d.cts"), "// d");
  writeFileSync(join(root, "src", "e.js"), "// e — must NOT be discovered");
  writeFileSync(join(root, "src", "deep", "f.ts"), "// f");
  return root;
}

describe("discoverFiles", () => {
  test("default: src/**/*.{ts,tsx,mts,cts}", async () => {
    const root = fixture();
    const files = await discoverFiles({ cwd: root, patterns: [] });
    const rel = files.map((f) => f.replace(`${root}/`, "")).sort();
    expect(rel).toEqual(["src/a.ts", "src/b.tsx", "src/c.mts", "src/d.cts", "src/deep/f.ts"]);
  });

  test("explicit patterns override default", async () => {
    const root = fixture();
    const files = await discoverFiles({ cwd: root, patterns: ["src/a.ts"] });
    const rel = files.map((f) => f.replace(`${root}/`, ""));
    expect(rel).toEqual(["src/a.ts"]);
  });

  test("ignores node_modules and dist by default", async () => {
    const root = fixture();
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "node_modules", "x", "y.ts"), "// y");
    writeFileSync(join(root, "dist", "z.ts"), "// z");
    const files = await discoverFiles({ cwd: root, patterns: [] });
    const all = files.map((f) => f.replace(`${root}/`, ""));
    expect(all.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(all.some((p) => p.startsWith("dist/"))).toBe(false);
  });
});
