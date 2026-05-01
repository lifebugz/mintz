import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearProjectCache, getOrCreateProject } from "../../src/engine/project-cache";

describe("project cache", () => {
  const tmpdirs: string[] = [];

  afterEach(() => {
    clearProjectCache();
    for (const d of tmpdirs) rmSync(d, { recursive: true, force: true });
    tmpdirs.length = 0;
  });

  function makeFixture(name: string): { dir: string; tsconfigPath: string } {
    const dir = mkdtempSync(join(tmpdir(), `mintz-${name}-`));
    tmpdirs.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", strict: true },
        include: ["src/**/*"],
      }),
    );
    writeFileSync(join(dir, "src/index.ts"), 'export const x = "a" as const;');
    return { dir, tsconfigPath: join(dir, "tsconfig.json") };
  }

  test("walks up from a file to find tsconfig", () => {
    const { dir, tsconfigPath } = makeFixture("walk");
    const filePath = join(dir, "src/index.ts");
    const project = getOrCreateProject(undefined, filePath);
    expect(project.getCompilerOptions().target).toBeDefined();
    // Cache key reflects the actual tsconfig discovered.
    const project2 = getOrCreateProject(tsconfigPath, filePath);
    expect(project2).toBe(project);
  });

  test("uses explicit tsconfigPath if provided", () => {
    const { tsconfigPath } = makeFixture("explicit");
    const a = getOrCreateProject(tsconfigPath);
    const b = getOrCreateProject(tsconfigPath);
    expect(a).toBe(b); // cached
  });

  test("different tsconfigs produce different Project instances", () => {
    const a = makeFixture("a");
    const b = makeFixture("b");
    const pa = getOrCreateProject(a.tsconfigPath);
    const pb = getOrCreateProject(b.tsconfigPath);
    expect(pa).not.toBe(pb);
  });

  test("clearProjectCache resets the cache", () => {
    const { tsconfigPath } = makeFixture("clear");
    const a = getOrCreateProject(tsconfigPath);
    clearProjectCache();
    const b = getOrCreateProject(tsconfigPath);
    expect(a).not.toBe(b);
  });
});
