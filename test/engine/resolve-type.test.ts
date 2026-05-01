import { describe, expect, test } from "bun:test";
import { Project, SyntaxKind } from "ts-morph";
import { resolveTypeToLiterals } from "../../src/engine/resolve-type";

function callTypeFromCode(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/src/index.ts", code);
  const call = file.getFirstDescendantByKindOrThrow(SyntaxKind.CallExpression);
  const typeArg = call.getTypeArguments()[0];
  if (!typeArg) throw new Error("expected a type argument");
  return { call, type: typeArg.getType() };
}

describe("resolveTypeToLiterals", () => {
  test("string literal union", () => {
    const { type } = callTypeFromCode('declare function mint<T>(): T; mint<"a" | "b">();');
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.literals).toEqual([
        { kind: "string", value: "a" },
        { kind: "string", value: "b" },
      ]);
    }
  });

  test("rejects open string", () => {
    const { type } = callTypeFromCode("declare function mint<T>(): T; mint<string>();");
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("OPEN_TYPE");
  });

  test("rejects mixed open + literal", () => {
    const { type } = callTypeFromCode('declare function mint<T>(): T; mint<"a" | string>();');
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("OPEN_TYPE");
  });

  test("rejects never", () => {
    const { type } = callTypeFromCode("declare function mint<T>(): T; mint<never>();");
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("EMPTY_UNION");
  });

  test("rejects object type", () => {
    const { type } = callTypeFromCode("declare function mint<T>(): T; mint<{ a: 1 }>();");
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("NON_LITERAL_TYPE");
  });

  test("rejects object union", () => {
    const { type } = callTypeFromCode(
      "declare function mint<T>(): T; mint<{ kind: 'a' } | { kind: 'b' }>();",
    );
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostic.code).toBe("NON_LITERAL_TYPE");
      expect(r.diagnostic.suggestions?.[0]).toMatch(/indexed access/);
    }
  });

  test("numeric literal union", () => {
    const { type } = callTypeFromCode("declare function mint<T>(): T; mint<1 | 2 | 3>();");
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const values = r.literals.map((l) => (l.kind === "number" ? l.value : null));
      expect(values).toEqual([1, 2, 3]);
    }
  });

  test("boolean true | false", () => {
    const { type } = callTypeFromCode("declare function mint<T>(): T; mint<boolean>();");
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
  });

  test("null", () => {
    const { type } = callTypeFromCode('declare function mint<T>(): T; mint<"a" | null>();');
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
  });

  test("undefined", () => {
    const { type } = callTypeFromCode('declare function mint<T>(): T; mint<"a" | undefined>();');
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
  });
});
