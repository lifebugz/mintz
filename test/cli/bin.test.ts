import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

// citty's runMain logs help/version via consola; consola suppresses
// `consola.log()` when NODE_ENV=test, which `bun test` sets implicitly.
// Strip it from the spawned-process env so the CLI prints normally.
function spawnEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.NODE_ENV;
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}

describe("mintz CLI bin", () => {
  test("--help shows usage", async () => {
    const proc = Bun.spawn(["bun", CLI, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv(),
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out).toContain("mintz");
    expect(out).toContain("--check");
    expect(out).toContain("--watch");
  });

  test("--check exits non-zero on drift", async () => {
    const root = mkdtempSync(join(tmpdir(), "mintz-bin-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            paths: { mintz: [join(import.meta.dir, "..", "..", "src", "runtime.ts")] },
          },
          include: ["src/**/*"],
        }),
      );
      writeFileSync(
        join(root, "src", "x.ts"),
        ['import mint from "mintz";', 'export const x = mint<"a">();'].join("\n"),
      );
      const proc = Bun.spawn(
        ["bun", CLI, "--check", "--silent", "--tsconfig", join(root, "tsconfig.json")],
        { cwd: root, stdout: "pipe", stderr: "pipe", env: spawnEnv() },
      );
      const exitCode = await proc.exited;
      expect(exitCode).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
