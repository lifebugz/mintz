import { describe, expect, test } from "bun:test";
import mint from "../src/runtime";
import { MintzNotTransformedError } from "../src/errors";

describe("mint() runtime", () => {
  test("returns the values argument unchanged when called with one", () => {
    const arr = ["a", "b", "c"] as const;
    const result = mint<"a" | "b" | "c">(arr);
    expect(result).toBe(arr);
  });

  test("returns the values argument when explicitly undefined inside", () => {
    const arr = ["a", undefined] as const;
    const result = mint<"a" | undefined>(arr);
    expect(result).toEqual(arr);
  });

  test("treats undefined values argument as 'invoked' (not 'missing')", () => {
    const result = mint<"a">(undefined);
    // The narrow public return type says `readonly "a"[]`, so `toBe(undefined)`
    // would type-mismatch. `toBeUndefined()` has an unconstrained signature
    // and asserts the runtime value irrespective of declared type.
    expect(result).toBeUndefined();
  });

  test("throws MintzNotTransformedError when called with no arguments", () => {
    expect(() => mint<"a" | "b">()).toThrow(MintzNotTransformedError);
  });

  test("error message names the three setup paths", () => {
    try {
      mint<"a">();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("Bun runtime/test");
      expect(msg).toContain("Bun bundler");
      expect(msg).toContain("Node + tsc");
      expect(msg).toContain("CI");
      return;
    }
    throw new Error("expected mint() to throw");
  });
});
