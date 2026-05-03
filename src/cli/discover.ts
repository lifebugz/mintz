import { Glob } from "bun";
import { resolve } from "node:path";

const DEFAULT_PATTERNS = ["src/**/*.ts", "src/**/*.tsx", "src/**/*.mts", "src/**/*.cts"];
const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**", "**/*.d.ts"];

export interface DiscoverOptions {
  readonly cwd: string;
  readonly patterns: readonly string[];
  readonly ignore?: readonly string[];
}

export async function discoverFiles(opts: DiscoverOptions): Promise<readonly string[]> {
  const patterns = opts.patterns.length > 0 ? opts.patterns : DEFAULT_PATTERNS;
  const ignoreGlobs = (opts.ignore ?? DEFAULT_IGNORE).map((p) => new Glob(p));

  const matches = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const rel of glob.scan({ cwd: opts.cwd, onlyFiles: true })) {
      if (ignoreGlobs.some((g) => g.match(rel))) continue;
      matches.add(resolve(opts.cwd, rel));
    }
  }
  return Array.from(matches).sort();
}
