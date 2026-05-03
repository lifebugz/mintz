import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { findMintCalls } from "../../src/engine/find-calls";

function makeProject(sources: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, code] of Object.entries(sources)) {
    project.createSourceFile(path, code);
  }
  return project;
}

describe("findMintCalls", () => {
  test("finds a default-import call", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts": 'import mint from "/mintz/runtime";\nconst x = mint<"a" | "b">();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(1);
  });

  test("finds a named-import call", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts": 'import { mint } from "/mintz/runtime";\nconst x = mint<"a">();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(1);
  });

  test("finds a renamed-import call", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts": 'import { default as m } from "/mintz/runtime";\nconst x = m<"a">();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(1);
  });

  test("ignores a local function named mint that shadows the import", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts": 'function mint() { return "local"; }\nconst x = mint();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(0);
  });

  test("finds multiple calls in the same file", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts":
        'import mint from "/mintz/runtime";\n' +
        'const a = mint<"x" | "y">();\n' +
        "const b = mint<1 | 2>();",
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(2);
  });
});
