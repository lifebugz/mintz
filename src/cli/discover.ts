import fg from "fast-glob";
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
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const matches = await fg([...patterns], {
    cwd: opts.cwd,
    absolute: true,
    onlyFiles: true,
    ignore: [...ignore],
  });
  return matches.map((p) => resolve(p)).sort();
}
