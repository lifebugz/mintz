import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project } from "ts-morph";
import { transform } from "../../src/engine";

const FIXTURES_DIR = resolve(import.meta.dir, "..", "fixtures");
const projects = new Map<string, Project>();

afterAll(() => projects.clear());

function projectFor(fixtureDir: string): Project {
  const tsconfigPath = join(fixtureDir, "tsconfig.json");
  let project = projects.get(tsconfigPath);
  if (!project) {
    project = new Project({
      tsConfigFilePath: tsconfigPath,
      skipAddingFilesFromTsConfig: false,
    });
    projects.set(tsconfigPath, project);
  }
  return project;
}

function pickFile(dir: string, base: string): string {
  const tsx = join(dir, `${base}.tsx`);
  const ts = join(dir, `${base}.ts`);
  const dts = join(dir, `${base}.d.ts`);
  if (existsSync(tsx)) return tsx;
  if (existsSync(ts)) return ts;
  if (existsSync(dts)) return dts;
  throw new Error(`No ${base}.{ts,tsx,d.ts} found in ${dir}`);
}

describe("engine fixtures (success)", () => {
  if (!existsSync(FIXTURES_DIR)) return;
  const successDirs = readdirSync(FIXTURES_DIR)
    .filter((d) => d !== "error" && !d.startsWith("."))
    .sort();

  for (const fixtureName of successDirs) {
    const dir = join(FIXTURES_DIR, fixtureName);
    test(fixtureName, () => {
      const inputPath = pickFile(dir, "input");
      const expectedPath = pickFile(dir, "expected");
      const input = readFileSync(inputPath, "utf8");
      const expected = readFileSync(expectedPath, "utf8");
      const result = transform({
        source: input,
        filename: inputPath,
        project: projectFor(dir),
        mode: "inline",
        mintzModulePath: "mintz",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBe(expected);
    });
  }
});

describe("engine fixtures (errors)", () => {
  const errorDir = join(FIXTURES_DIR, "error");
  if (!existsSync(errorDir)) return;
  const errorDirs = readdirSync(errorDir).sort();

  for (const fixtureName of errorDirs) {
    const dir = join(errorDir, fixtureName);
    test(`error/${fixtureName}`, () => {
      const inputPath = pickFile(dir, "input");
      const expectedCodePath = join(dir, "expected-code.txt");
      const input = readFileSync(inputPath, "utf8");
      const expectedCode = readFileSync(expectedCodePath, "utf8").trim();
      const result = transform({
        source: input,
        filename: inputPath,
        project: projectFor(dir),
        mode: "inline",
        mintzModulePath: "mintz",
      });
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]!.code).toBe(expectedCode);
    });
  }
});
