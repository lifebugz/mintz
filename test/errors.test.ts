import { describe, expect, test } from "bun:test";
import { MintzNotTransformedError, formatDiagnostic, type Diagnostic } from "../src/errors";

describe("MintzNotTransformedError", () => {
  test("is an Error subclass", () => {
    const err = new MintzNotTransformedError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MintzNotTransformedError");
  });

  test("multi-line message names every setup path", () => {
    const msg = new MintzNotTransformedError().message;
    expect(msg).toMatch(/mint<T>\(\)/);
    expect(msg).toMatch(/Bun runtime\/test/);
    expect(msg).toMatch(/Bun bundler/);
    expect(msg).toMatch(/Node \+ tsc/);
    expect(msg).toMatch(/CI/);
    expect(msg).toMatch(/github\.com\/.*\/mintz/);
  });

  test("includes call site when V8 stack trace is available", () => {
    function caller() {
      return new MintzNotTransformedError();
    }
    const err = caller();
    if (typeof Error.captureStackTrace === "function") {
      expect(err.message).toMatch(/Call site:.*errors\.test\.ts/);
    }
  });
});

describe("formatDiagnostic", () => {
  test("produces the Rust-style multi-line format", () => {
    const d: Diagnostic = {
      severity: "error",
      code: "OPEN_TYPE",
      message: "T contains the open type `string`, which has infinite values.",
      file: "src/events.ts",
      line: 14,
      column: 23,
      sourceLine: "  const events = mint<MaybeEvents>();",
      caretLength: 11,
      resolvedType: 'string | "lobby.reaction"',
      suggestions: ['Use `Extract<MaybeEvents, "lobby.reaction">` to narrow.'],
    };
    const out = formatDiagnostic(d);
    expect(out).toContain("ERROR mintz: ");
    expect(out).toContain("src/events.ts:14:23");
    expect(out).toContain("const events = mint<MaybeEvents>()");
    expect(out).toContain("^^^^^^^^^^^");
    expect(out).toContain("T resolved to:");
    expect(out).toContain("Possible fixes:");
    expect(out).toContain("Use `Extract<");
  });

  test("warning severity uses 'WARNING' label", () => {
    const out = formatDiagnostic({
      severity: "warning",
      code: "DEPRECATED",
      message: "test warning",
      file: "x.ts",
      line: 1,
      column: 1,
      sourceLine: "x",
      caretLength: 1,
    });
    expect(out).toMatch(/^WARNING mintz/);
  });
});
