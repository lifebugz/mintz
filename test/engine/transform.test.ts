import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { transform } from "../../src/engine";

const MINTZ_RUNTIME = "/virtual/mintz/runtime";
const MINTZ_RUNTIME_SRC =
  "export default function mint<T>(values?: readonly T[]) { return (values ?? []) as readonly T[]; }";

function setup(userSource: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(`${MINTZ_RUNTIME}.ts`, MINTZ_RUNTIME_SRC);
  const file = project.createSourceFile("/src/user.ts", userSource);
  return { project, file };
}

describe("transform", () => {
  test("rewrites a state-1 call to inline array (build mode)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` + 'const events = mint<"a" | "b">();\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain('["a", "b"] as const');
    expect(result.code).not.toContain('mint<"a" | "b">()');
  });

  test("rewrites a state-1 call to wrapped form (codegen mode)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` + 'const events = mint<"a" | "b">();\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "wrapped",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(true);
    expect(result.code).toContain('mint<"a" | "b">(["a", "b"])');
  });

  test("inlines a state-2 call (already codegen'd) in inline mode", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` + 'const events = mint<"a" | "b">(["stale"]);\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.code).toContain('["a", "b"] as const');
    expect(result.code).not.toContain('"stale"');
  });

  test("re-resolves a state-2 call in wrapped mode (drift detection)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` + 'const events = mint<"a" | "b">(["a"]);\n'; // stale
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "wrapped",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(true);
    expect(result.code).toContain('mint<"a" | "b">(["a", "b"])');
  });

  test("returns modified=false when nothing changes (idempotent)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` + 'const events = mint<"a" | "b">(["a", "b"]);\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "wrapped",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(false);
    expect(result.code).toBe(userSource);
  });

  test("emits a diagnostic for open string", () => {
    const userSource = `import mint from "${MINTZ_RUNTIME}";\n` + "const x = mint<string>();\n";
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("OPEN_TYPE");
    expect(result.modified).toBe(false);
  });

  test("fast-skip via missing import: no transform on unrelated files", () => {
    const userSource = "export const greet = (n: string) => `hi ${n}`;\n";
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(false);
    expect(result.diagnostics).toHaveLength(0);
  });
});
