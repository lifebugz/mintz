import { describe, expect, test } from "bun:test";
import { sortLiterals } from "../../src/engine/classify";
import type { LiteralValue } from "../../src/engine/types";

describe("sortLiterals", () => {
  test("strings sort by UTF-16 code-unit", () => {
    const input: LiteralValue[] = [
      { kind: "string", value: "café" },
      { kind: "string", value: "apple" },
      { kind: "string", value: "Banana" },
    ];
    const out = sortLiterals(input);
    // "Banana" (B = 0x42) < "apple" (a = 0x61) < "café" (c = 0x63)
    expect(out.map((l) => (l.kind === "string" ? l.value : null))).toEqual([
      "Banana",
      "apple",
      "café",
    ]);
  });

  test("numbers sort numerically including negatives", () => {
    const input: LiteralValue[] = [
      { kind: "number", value: 10 },
      { kind: "number", value: -1 },
      { kind: "number", value: 0 },
      { kind: "number", value: 2 },
    ];
    const out = sortLiterals(input);
    expect(out.map((l) => (l.kind === "number" ? l.value : null))).toEqual([-1, 0, 2, 10]);
  });

  test("booleans: false before true", () => {
    const input: LiteralValue[] = [
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
    ];
    const out = sortLiterals(input);
    expect(out).toEqual([
      { kind: "boolean", value: false },
      { kind: "boolean", value: true },
    ]);
  });

  test("bigints sort numerically", () => {
    const input: LiteralValue[] = [
      { kind: "bigint", value: 100n },
      { kind: "bigint", value: 1n },
      { kind: "bigint", value: 2n },
    ];
    const out = sortLiterals(input);
    expect(out.map((l) => (l.kind === "bigint" ? l.value : null))).toEqual([1n, 2n, 100n]);
  });

  test("mixed kinds: strings, numbers, bigints, booleans, null, undefined", () => {
    const input: LiteralValue[] = [
      { kind: "undefined" },
      { kind: "boolean", value: true },
      { kind: "null" },
      { kind: "string", value: "z" },
      { kind: "string", value: "a" },
      { kind: "number", value: 1 },
      { kind: "bigint", value: 2n },
    ];
    const out = sortLiterals(input);
    expect(out).toEqual([
      { kind: "string", value: "a" },
      { kind: "string", value: "z" },
      { kind: "number", value: 1 },
      { kind: "bigint", value: 2n },
      { kind: "boolean", value: true },
      { kind: "null" },
      { kind: "undefined" },
    ]);
  });

  test("dedupes identical literals (TS would already, but defense in depth)", () => {
    const input: LiteralValue[] = [
      { kind: "string", value: "a" },
      { kind: "string", value: "a" },
      { kind: "string", value: "b" },
    ];
    const out = sortLiterals(input);
    expect(out).toHaveLength(2);
  });
});
