import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Project } from "ts-morph";

const cache = new Map<string, Project>();

export function getOrCreateProject(tsconfigPath: string | undefined, filePath?: string): Project {
  const resolvedTsconfig = tsconfigPath ? resolve(tsconfigPath) : findTsconfig(filePath);

  const cacheKey = resolvedTsconfig ?? "<default>";
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const project = new Project(
    resolvedTsconfig ? { tsConfigFilePath: resolvedTsconfig } : { useInMemoryFileSystem: false },
  );
  cache.set(cacheKey, project);
  return project;
}

export function clearProjectCache(): void {
  cache.clear();
}

function findTsconfig(startFile: string | undefined): string | undefined {
  if (!startFile) return undefined;
  const start = isAbsolute(startFile) ? startFile : resolve(startFile);
  let dir = dirname(start);
  // Walk up to filesystem root.
  for (let i = 0; i < 64; i++) {
    const candidate = resolve(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
