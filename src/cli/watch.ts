import chokidar from "chokidar";
import { runRewrite } from "./rewrite";
import type { RunOptions } from "./rewrite";

export interface WatchHandle {
  stop(): Promise<void>;
}

export function runWatch(opts: RunOptions): WatchHandle & Promise<number> {
  let stopped = false;
  const cwd = opts.cwd ?? process.cwd();

  // Initial pass.
  let inProgress: Promise<number> = runRewrite(opts);

  // chokidar v4 removed glob support: watch directories, filter via `ignored`.
  const watchTargets = opts.paths.length > 0 ? [...opts.paths] : ["src"];

  const watcher = chokidar.watch(watchTargets, {
    cwd,
    ignored: (filePath, stats) => {
      if (filePath.includes("node_modules") || filePath.includes("/dist/")) return true;
      if (filePath.endsWith(".d.ts")) return true;
      if (stats?.isFile()) {
        return !/\.(ts|tsx|mts|cts)$/.test(filePath);
      }
      return false;
    },
    ignoreInitial: true,
  });

  const onChange = (): void => {
    if (stopped) return;
    inProgress = inProgress.then(() => runRewrite(opts));
  };
  watcher.on("change", onChange);
  watcher.on("add", onChange);

  // Return a promise that never resolves on its own; users call stop() to end.
  const promise = new Promise<number>(() => undefined) as WatchHandle & Promise<number>;
  promise.stop = async () => {
    stopped = true;
    await watcher.close();
    await inProgress;
  };
  return promise;
}
