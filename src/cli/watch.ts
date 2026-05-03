import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import { runRewrite } from "./rewrite";
import type { RunOptions } from "./rewrite";

export interface WatchHandle {
  stop(): Promise<void>;
}

const TS_FILE_RE = /\.(ts|tsx|mts|cts)$/;
const SOURCE_IGNORE_RE = /(?:^|[\\/])(?:node_modules|dist)(?:[\\/]|$)/;

function shouldHandle(relPath: string | null): boolean {
  if (relPath === null) return false;
  if (relPath.endsWith(".d.ts")) return false;
  if (SOURCE_IGNORE_RE.test(relPath)) return false;
  return TS_FILE_RE.test(relPath);
}

export function runWatch(opts: RunOptions): WatchHandle & Promise<number> {
  let stopped = false;
  const cwd = opts.cwd ?? process.cwd();

  // Initial pass — runs once before we arm the watchers.
  let inProgress: Promise<number> = runRewrite(opts);

  const watchTargets = opts.paths.length > 0 ? [...opts.paths] : ["src"];
  const watchers: FSWatcher[] = [];

  for (const target of watchTargets) {
    const absTarget = resolve(cwd, target);
    const watcher = watch(absTarget, { recursive: true }, (_event, filename) => {
      if (stopped) return;
      if (!shouldHandle(filename)) return;
      inProgress = inProgress.then(() => runRewrite(opts));
    });
    watchers.push(watcher);
  }

  // Return a promise that never resolves on its own; users call stop() to end.
  const promise = new Promise<number>(() => undefined) as WatchHandle & Promise<number>;
  promise.stop = async () => {
    stopped = true;
    for (const w of watchers) w.close();
    await inProgress;
  };
  return promise;
}
