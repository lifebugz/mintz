import { describe, expect, test } from "bun:test";
import { emitInlineArray, emitWrappedCall } from "../../src/engine/emit";
import type { LiteralValue } from "../../src/engine/types";

describe("emitInlineArray (state 3)", () => {
  test("strings", () => {
    const lits: LiteralValue[] = [
      { kind: "string", value: "a" },
      { kind: "string", value: "b" },
    ];
    expect(emitInlineArray(lits)).toBe('["a", "b"] as const');
  });

  test("strings with quotes are escaped", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: 'has"quote' }];
    expect(emitInlineArray(lits)).toBe('["has\\"quote"] as const');
  });

  test("strings with backslashes are escaped", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: "a\\b" }];
    expect(emitInlineArray(lits)).toBe('["a\\\\b"] as const');
  });

  test("strings with newlines are escaped", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: "a\nb" }];
    expect(emitInlineArray(lits)).toBe('["a\\nb"] as const');
  });

  test("non-ASCII strings preserved", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: "café" }];
    expect(emitInlineArray(lits)).toBe('["café"] as const');
  });

  test("numbers, bigints, booleans, null, undefined", () => {
    const lits: LiteralValue[] = [
      { kind: "number", value: -1 },
      { kind: "number", value: 0 },
      { kind: "bigint", value: 100n },
      { kind: "boolean", value: true },
      { kind: "null" },
      { kind: "undefined" },
    ];
    expect(emitInlineArray(lits)).toBe("[-1, 0, 100n, true, null, undefined] as const");
  });

  test("breaks long arrays into multi-line form (>80 chars)", () => {
    const lits: LiteralValue[] = Array.from({ length: 6 }, (_, i) => ({
      kind: "string" as const,
      value: `event.name.${"x".repeat(8)}.${i}`,
    }));
    const out = emitInlineArray(lits);
    expect(out).toContain("\n");
    expect(out.endsWith("] as const")).toBe(true);
  });
});

describe("emitWrappedCall (state 2)", () => {
  test("preserves the type argument text and adds the values arg", () => {
    const out = emitWrappedCall("ClientToServerEvent['event']", [
      { kind: "string", value: "a" },
      { kind: "string", value: "b" },
    ]);
    expect(out).toBe('mint<ClientToServerEvent[\'event\']>(["a", "b"])');
  });

  test("uses the original callee text when provided (alias support)", () => {
    const out = emitWrappedCall(
      "Status",
      [{ kind: "string", value: "ok" }],
      "m", // user wrote `import { default as m } from "mintz"`
    );
    expect(out).toBe('m<Status>(["ok"])');
  });
});
