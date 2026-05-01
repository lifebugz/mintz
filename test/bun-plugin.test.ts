import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mintzPlugin from "../src/bun";

function makeProject(): { dir: string; entry: string } {
  const dir = mkdtempSync(join(tmpdir(), "mintz-bun-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        paths: { mintz: [join(import.meta.dir, "..", "src", "runtime.ts")] },
      },
      include: ["src/**/*"],
    }),
  );
  const entry = join(dir, "src", "entry.ts");
  writeFileSync(
    entry,
    [
      'import mint from "mintz";',
      'export const events = mint<"a" | "b" | "c">();',
      "console.log(events.length);",
    ].join("\n"),
  );
  return { dir, entry };
}

describe("Bun plugin", () => {
  test("inlines mint() calls during Bun.build", async () => {
    const { dir, entry } = makeProject();
    try {
      const result = await Bun.build({
        entrypoints: [entry],
        outdir: join(dir, "dist"),
        plugins: [mintzPlugin({ tsconfig: join(dir, "tsconfig.json") })],
        target: "bun",
      });
      expect(result.success).toBe(true);
      const outFile = result.outputs.find((o) => o.path.endsWith("entry.js"));
      expect(outFile).toBeDefined();
      const text = await outFile!.text();
      expect(text).toContain('"a"');
      expect(text).toContain('"b"');
      expect(text).toContain('"c"');
      expect(text).not.toContain('mint<"a"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails the build when T is unresolvable", async () => {
    const { dir, entry } = makeProject();
    writeFileSync(
      entry,
      ['import mint from "mintz";', "export const x = mint<string>();"].join("\n"),
    );
    // Bun's plugin error model: a throw inside `onLoad` propagates as a
    // BuildMessage / AggregateError to the caller of Bun.build(), rather
    // than being collected into result.logs. Match that behavior here.
    try {
      let caught: unknown = null;
      try {
        await Bun.build({
          entrypoints: [entry],
          outdir: join(dir, "dist"),
          plugins: [mintzPlugin({ tsconfig: join(dir, "tsconfig.json") })],
          target: "bun",
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).not.toBeNull();
      // Bun wraps plugin throws in AggregateError("Bundle failed").
      // Surface the original error messages from `errors`.
      const errs = (caught as AggregateError | (Error & { errors?: unknown[] })).errors;
      const detail = Array.isArray(errs)
        ? errs.map((e) => (e instanceof Error ? e.message : String(e))).join("\n")
        : String(caught);
      // formatDiagnostic emits the human-readable form ("open type")
      // rather than the machine code ("OPEN_TYPE"). Match the user-visible
      // build log content.
      expect(detail).toContain("ERROR mintz");
      expect(detail).toContain("open type");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
