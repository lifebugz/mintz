import { readFile } from "node:fs/promises";
import { transform } from "../engine";
import { getOrCreateProject } from "../engine/project-cache";
import { formatDiagnostic } from "../errors";
import { discoverFiles } from "./discover";
import type { RunOptions } from "./rewrite";

export async function runCheck(opts: RunOptions): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const files = await discoverFiles({ cwd, patterns: opts.paths });
  let driftedCount = 0;
  let errorCount = 0;

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
      if (opts.json) process.stderr.write(`${JSON.stringify(d)}\n`);
      else if (!opts.silent) process.stderr.write(`${formatDiagnostic(d)}\n\n`);
      if (d.severity === "error") errorCount++;
    }
    if (result.modified) {
      driftedCount++;
      if (!opts.silent) {
        process.stderr.write(`drift: ${path}\n`);
      }
    }
  }

  if (!opts.silent) {
    if (driftedCount === 0 && errorCount === 0) {
      process.stdout.write("mintz check: source is in sync with types\n");
    } else {
      process.stderr.write(`mintz check: ${driftedCount} drifted, ${errorCount} error(s)\n`);
    }
  }
  return driftedCount + errorCount > 0 ? 1 : 0;
}
