import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { transform } from "../engine";
import { getOrCreateProject } from "../engine/project-cache";
import { formatDiagnostic } from "../errors";
import { discoverFiles } from "./discover";

export interface RunOptions {
  readonly cwd?: string;
  readonly paths: readonly string[];
  readonly tsconfig?: string;
  readonly json: boolean;
  readonly silent: boolean;
  readonly dryRun: boolean;
}

export async function runRewrite(opts: RunOptions): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const files = await discoverFiles({ cwd, patterns: opts.paths });
  let errorCount = 0;
  let modifiedCount = 0;

  for (const path of files) {
    const source = await readFile(path, "utf8");
    if (!source.includes("mintz")) continue;
    const project = getOrCreateProject(opts.tsconfig, path);
    const result = transform({
      source,
      filename: path,
      project,
      mode: "wrapped",
      mintzModulePath: "mintz",
    });
    for (const d of result.diagnostics) {
      if (opts.json) {
        process.stderr.write(`${JSON.stringify(d)}\n`);
      } else if (!opts.silent) {
        process.stderr.write(`${formatDiagnostic(d)}\n\n`);
      }
      if (d.severity === "error") errorCount++;
    }
    if (result.modified && !opts.dryRun) {
      await atomicWrite(path, result.code);
      modifiedCount++;
    } else if (result.modified) {
      modifiedCount++;
    }
  }

  if (!opts.silent) {
    process.stdout.write(
      `mintz: ${modifiedCount} file(s) ${opts.dryRun ? "would change" : "rewritten"}` +
        `${errorCount > 0 ? `, ${errorCount} error(s)` : ""}\n`,
    );
  }
  return errorCount > 0 ? 1 : 0;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const tmp = `${dirname(path)}/.${basename(path)}.mintz-tmp`;
  await writeFile(tmp, contents, "utf8");
  try {
    await rename(tmp, path);
  } catch (err) {
    try {
      await writeFile(path, contents, "utf8");
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
  }
}
