# mintz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build mintz v1 — a single-primitive TypeScript reflection library (`mint<T>()`) that resolves literal-union types to runtime arrays via a Bun plugin or CLI codegen, per spec at `docs/superpowers/specs/2026-04-30-mintz-design.md`.

**Architecture:** One ts-morph–based transform engine wrapped by three thin shells: a Bun plugin (`mintz/bun`) used in both `Bun.build` and `bunfig.toml` preload, a Node-compatible CLI (`mintz` bin) for codegen, and a 30-LOC runtime stub. Drift detection is a first-class feature via `mintz --check`.

**Tech Stack:** TypeScript 5.4+, ts-morph 28+, Bun 1.x, tsup (build), Biome (lint+format), citty (CLI args), chokidar (`--watch`), tsd (type-level tests), bun test (everything else).

**Scope discipline:** §2 non-goals from the spec are **hard cuts** for this plan. No unplugin wrapper, no ts-patch transformer, no JSR publishing, no convenience helpers (`mintEntries`/`pluck`/etc.), no native NAPI plugin, no persistent on-disk cache. If a task tempts you to add one of these, stop and confirm with the user.

---

## File Structure

```
mintz/                                    # repo root (currently in tsref/ working dir)
├── package.json                          # name "mintz", default + ./bun + bin
├── tsconfig.json                         # strict, ESM, 5.4+ target
├── tsup.config.ts                        # build config: 3 entries → ESM + .d.ts
├── biome.json                            # lint + format
├── bunfig.toml                           # local dev preload
├── .gitignore
├── LICENSE                               # MIT
├── README.md                             # value prop, install, recipes
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                        # matrix: TS×runtime×OS
│   │   └── release.yml                   # publish on tag
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug.yml
│   │   └── feature.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── src/
│   ├── runtime.ts                        # ~30 LOC: mint() function
│   ├── errors.ts                         # ~120 LOC: MintzNotTransformedError + diagnostic formatter
│   ├── engine/
│   │   ├── index.ts                      # ~120 LOC: transform() entry
│   │   ├── types.ts                      # shared types (Diagnostic, TransformResult, LiteralValue)
│   │   ├── project-cache.ts              # ~80 LOC: getOrCreateProject keyed by tsconfig
│   │   ├── find-calls.ts                 # ~150 LOC: locate mint<T>() call sites by symbol identity
│   │   ├── resolve-type.ts               # ~150 LOC: resolve T's union via TypeChecker
│   │   ├── classify.ts                   # ~80 LOC: validate + sort literals deterministically
│   │   └── emit.ts                       # ~80 LOC: emit `[lit, lit, ...] as const` AST text
│   ├── bun/
│   │   └── index.ts                      # ~80 LOC: BunPlugin factory
│   └── cli/
│       ├── index.ts                      # ~80 LOC: citty entrypoint, dispatch
│       ├── discover.ts                   # ~80 LOC: glob + tsconfig discovery
│       ├── rewrite.ts                    # ~100 LOC: per-file engine call + atomic write
│       ├── check.ts                      # ~50 LOC: --check mode (no writes)
│       └── watch.ts                      # ~60 LOC: chokidar wiring
├── test/
│   ├── runtime.test.ts
│   ├── errors.test.ts
│   ├── engine/
│   │   ├── fixtures.test.ts              # iterates over test/fixtures/, asserts each
│   │   ├── project-cache.test.ts
│   │   ├── classify.test.ts
│   │   └── ordering.test.ts
│   ├── fixtures/                         # one directory per case (input.ts + expected.ts + tsconfig.json)
│   │   ├── 01-string-union/
│   │   ├── 02-number-union/
│   │   ├── 03-boolean-null-undefined/
│   │   ├── 04-bigint-union/
│   │   ├── 05-numeric-enum/
│   │   ├── 06-string-enum/
│   │   ├── 07-indexed-access/
│   │   ├── 08-keyof-typeof-const/
│   │   ├── 09-exclude/
│   │   ├── 10-template-literal/
│   │   ├── 11-mixed-kinds/
│   │   ├── 12-renamed-import/
│   │   ├── 13-re-export-barrel/
│   │   ├── 14-jsx-attribute/
│   │   ├── 15-comment-preservation/
│   │   ├── 16-multiple-calls/
│   │   ├── 17-cross-file/
│   │   ├── 18-already-codegend/        # state-2 input → re-resolves
│   │   └── error/
│   │       ├── 01-open-string/
│   │       ├── 02-string-mixed/
│   │       ├── 03-never/
│   │       ├── 04-infinite-template/
│   │       ├── 05-object-type/
│   │       ├── 06-object-union/
│   │       ├── 07-generic-param/
│   │       ├── 08-any/
│   │       └── 09-d-ts-call/
│   ├── bun-plugin.test.ts
│   ├── cli/
│   │   ├── rewrite.test.ts
│   │   ├── check.test.ts
│   │   └── watch.test.ts
│   └── types.test-d.ts                   # tsd assertions
├── examples/
│   └── ws-events/                        # the motivating wire-protocol case
│       ├── package.json
│       ├── tsconfig.json
│       ├── bunfig.toml
│       ├── preload.ts
│       └── src/
│           ├── ws-events.ts
│           └── server.ts
└── docs/                                 # the spec + this plan already live here
    └── superpowers/
        ├── specs/
        └── plans/
```

---

## Phase 0 — Project setup

### Task 1: Initialize package and dependencies

**Files:**
- Create: `package.json`
- Create: `bunfig.toml`
- Create: `.gitignore`

- [ ] **Step 1: Verify the working directory is the repo root**

Run: `pwd && git log --oneline | head`
Expected: working dir is `/Users/haim/projects/experiments/tsref`; git log shows the spec commits.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "mintz",
  "version": "0.0.0",
  "description": "Read your TypeScript types at runtime. Bun-native. Zero magic at the call site.",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/runtime.d.ts",
      "default": "./dist/runtime.js"
    },
    "./bun": {
      "types": "./dist/bun/index.d.ts",
      "default": "./dist/bun/index.js"
    }
  },
  "bin": {
    "mintz": "./dist/cli/index.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "workspaces": ["examples/*"],
  "engines": {
    "node": ">=20"
  },
  "peerDependencies": {
    "typescript": ">=5.4"
  },
  "dependencies": {
    "ts-morph": "^28.0.0",
    "citty": "^0.1.6",
    "chokidar": "^4.0.0",
    "fast-glob": "^3.3.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/bun": "latest",
    "tsd": "^0.31.0",
    "tsup": "^8.0.0",
    "typescript": "^5.6.0"
  },
  "scripts": {
    "build": "tsup",
    "test": "bun test",
    "test:types": "tsd",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write ."
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 3: Write `bunfig.toml`**

```toml
# Local development preload that registers the mintz plugin during
# `bun test` and `bun run`. Production users do this themselves.

# Once the engine works, uncomment to dogfood:
# preload = ["./scripts/dev-preload.ts"]

[install]
saveTextLockfile = true

# Coverage runs on every `bun test`. CI tightens the threshold further
# and fails the build on regression (see .github/workflows/ci.yml).
[test]
coverage = false           # opt-in via --coverage; keeps default `bun test` fast
coverageThreshold = { line = 0.90, function = 0.90, statement = 0.90 }
coverageSkipTestFiles = true
coveragePathIgnorePatterns = [
  "test/fixtures/**",
  "examples/**",
  "dist/**",
]
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local
coverage/
```

- [ ] **Step 5: Install dependencies**

Run: `bun install`
Expected: `bun.lock` written; `node_modules/` populated. No errors.

- [ ] **Step 6: Commit**

```bash
git add package.json bunfig.toml .gitignore bun.lock
git commit -m "chore: initialize package and dependencies"
```

---

### Task 2: TypeScript and tsup configs

**Files:**
- Create: `tsconfig.json`
- Create: `tsup.config.ts`

- [ ] **Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*", "tsup.config.ts"],
  "exclude": ["node_modules", "dist", "test/fixtures/**"]
}
```

- [ ] **Step 2: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    runtime: "src/runtime.ts",
    "bun/index": "src/bun/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  external: ["bun", "typescript", "ts-morph", "chokidar", "citty", "fast-glob"],
  banner: {
    js: "// mintz — TypeScript types you can read at runtime. https://github.com/<user>/mintz",
  },
});
```

- [ ] **Step 3: Verify typecheck passes on empty src tree**

Run: `mkdir -p src && echo 'export {};' > src/runtime.ts && bun run typecheck`
Expected: exits 0 (no source files to check yet).

- [ ] **Step 4: Verify build runs (will produce empty dist)**

Run: `bun run build`
Expected: tsup completes, writes `dist/runtime.js` and `dist/runtime.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json tsup.config.ts src/runtime.ts
git commit -m "chore: add tsconfig and tsup config"
```

---

### Task 3: Linting and formatting

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "ignoreUnknown": false,
    "ignore": ["dist", "node_modules", "test/fixtures/**", "*.md"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "style": {
        "useImportType": "error",
        "useExportType": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  }
}
```

- [ ] **Step 2: Run lint to verify config is valid**

Run: `bun run lint`
Expected: passes on empty src tree (only the placeholder `export {};` exists).

- [ ] **Step 3: Commit**

```bash
git add biome.json
git commit -m "chore: configure biome for lint and format"
```

---

## Phase 1 — Runtime stub

### Task 4: Implement `mint()` runtime function

**Files:**
- Modify: `src/runtime.ts` (currently has placeholder)
- Create: `test/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `test/runtime.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import mint from "../src/runtime";
import { MintzNotTransformedError } from "../src/errors";

describe("mint() runtime", () => {
  test("returns the values argument unchanged when called with one", () => {
    const arr = ["a", "b", "c"] as const;
    const result = mint<"a" | "b" | "c">(arr);
    expect(result).toBe(arr);
  });

  test("returns the values argument when explicitly undefined inside", () => {
    const arr = ["a", undefined] as const;
    const result = mint<"a" | undefined>(arr);
    expect(result).toEqual(arr);
  });

  test("treats undefined values argument as 'invoked' (not 'missing')", () => {
    // arguments.length is 1 here; should NOT throw.
    const result = mint<"a">(undefined as unknown as readonly "a"[]);
    expect(result).toBe(undefined);
  });

  test("throws MintzNotTransformedError when called with no arguments", () => {
    expect(() => mint<"a" | "b">()).toThrow(MintzNotTransformedError);
  });

  test("error message names the three setup paths", () => {
    try {
      mint<"a">();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("Bun runtime/test");
      expect(msg).toContain("Bun bundler");
      expect(msg).toContain("Node + tsc");
      expect(msg).toContain("CI");
      return;
    }
    throw new Error("expected mint() to throw");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/runtime.test.ts`
Expected: FAIL — `MintzNotTransformedError` is not yet exported (Task 5 creates it). At minimum the import will fail.

- [ ] **Step 3: Write `src/runtime.ts`**

```ts
import { MintzNotTransformedError } from "./errors";

export type Lit = string | number | boolean | bigint | null | undefined;

// Must be a `function` declaration (not arrow) to access `arguments.length`.
// `arguments.length` distinguishes "not invoked with values" from "invoked
// with values that happen to be undefined" — the latter is valid for
// `mint<'a' | undefined>(undefined)`. See spec §4.1.
function mint<T extends Lit>(values?: readonly T[]): readonly T[] {
  if (arguments.length > 0) {
    return values as readonly T[];
  }
  throw new MintzNotTransformedError();
}

export { mint };
export default mint;
```

Both export forms refer to the same function. Default-import (`import mint from "mintz"`) and named-import (`import { mint } from "mintz"`) both work, per spec §4.1.

- [ ] **Step 4: Re-run test (still failing, errors.ts not written)**

Run: `bun test test/runtime.test.ts`
Expected: FAIL — module `./errors` not found.

- [ ] **Step 5: Hold off committing until Task 5 is done (errors module is a hard dependency)**

---

### Task 5: Implement `MintzNotTransformedError`

**Files:**
- Create: `src/errors.ts`
- Create: `test/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Write `test/errors.test.ts`:

```ts
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
    // Otherwise call site is just absent; message still works.
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
      suggestions: [
        "Use `Extract<MaybeEvents, \"lobby.reaction\">` to narrow.",
      ],
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/errors.test.ts`
Expected: FAIL — `src/errors` does not exist.

- [ ] **Step 3: Write `src/errors.ts`**

```ts
export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly sourceLine: string;
  readonly caretLength: number;
  readonly resolvedType?: string;
  readonly suggestions?: readonly string[];
}

const DOCS_URL = "https://github.com/<user>/mintz#setup";

const NOT_TRANSFORMED_BODY = [
  "mint<T>() was called without runtime values. This means the",
  "build-time transform did not run on this file.",
  "",
  "To fix, choose one:",
  "  • Bun runtime/test:",
  "      Add a preload that registers the plugin:",
  "        // preload.ts",
  '        import { plugin } from "bun";',
  '        import mintz from "mintz/bun";',
  "        plugin(mintz());",
  "      Then in bunfig.toml:",
  '        preload = ["./preload.ts"]',
  "  • Bun bundler:",
  "      Add the plugin to Bun.build:",
  '        import mintz from "mintz/bun";',
  "        await Bun.build({ plugins: [mintz()], … });",
  "  • Node + tsc / ts-node / tsx:",
  "      Run `npx mintz` once to populate values.",
  '      Add to package.json:  "build": "mintz && tsc"',
  "  • CI:",
  "      Add `mintz --check` to fail PRs where source has drifted",
  "      from types.",
  "",
  `  See ${DOCS_URL}`,
].join("\n");

export class MintzNotTransformedError extends Error {
  override readonly name = "MintzNotTransformedError";
  readonly callSite: string | null;

  constructor() {
    let callSite: string | null = null;
    if (typeof Error.captureStackTrace === "function") {
      const probe: { stack?: string } = {};
      Error.captureStackTrace(probe, MintzNotTransformedError);
      callSite = extractFirstUserFrame(probe.stack);
    }
    const tail = callSite ? `\n  Call site: ${callSite}` : "";
    super(`${NOT_TRANSFORMED_BODY}${tail}`);
    this.callSite = callSite;
  }
}

function extractFirstUserFrame(stack: string | undefined): string | null {
  if (!stack) return null;
  // Lines look like "    at funcName (path/to/file.ts:line:col)"
  const lines = stack.split("\n").slice(1);
  for (const raw of lines) {
    const line = raw.trim();
    // Skip frames inside node_modules and the runtime stub itself.
    if (line.includes("node_modules")) continue;
    if (line.includes("runtime.ts")) continue;
    const m = line.match(/\((.+):(\d+):(\d+)\)$/) ?? line.match(/at (.+):(\d+):(\d+)$/);
    if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  }
  return null;
}

export function formatDiagnostic(d: Diagnostic): string {
  const label = d.severity === "error" ? "ERROR" : "WARNING";
  const header = `${label} mintz: ${d.message} at ${d.file}:${d.line}:${d.column}`;
  const caret = " ".repeat(Math.max(0, d.column - 1)) + "^".repeat(Math.max(1, d.caretLength));
  const lines: string[] = [header, "", `  ${d.sourceLine}`, `  ${caret}`];
  if (d.resolvedType) {
    lines.push("", `  T resolved to: ${d.resolvedType}`);
  }
  if (d.suggestions && d.suggestions.length > 0) {
    lines.push("", "  Possible fixes:");
    for (const s of d.suggestions) lines.push(`    • ${s}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/errors.test.ts test/runtime.test.ts`
Expected: PASS — both files green.

- [ ] **Step 5: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/runtime.ts src/errors.ts test/runtime.test.ts test/errors.test.ts
git commit -m "feat(runtime): add mint() and MintzNotTransformedError"
```

---

## Phase 2 — Engine core

### Task 6: Engine type definitions

**Files:**
- Create: `src/engine/types.ts`

- [ ] **Step 1: Write the type module**

```ts
import type { Project } from "ts-morph";
import type { Diagnostic } from "../errors";

export type LiteralValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "bigint"; readonly value: bigint }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "null" }
  | { readonly kind: "undefined" };

export interface TransformInput {
  /** Source text to transform. */
  readonly source: string;
  /** Absolute path of the source file (used for diagnostics + tsconfig lookup). */
  readonly filename: string;
  /** ts-morph Project providing the TypeChecker context. */
  readonly project: Project;
}

export interface TransformResult {
  /** Possibly-rewritten source text. Equal to input.source if `modified` is false. */
  readonly code: string;
  readonly modified: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export type Resolution =
  | { readonly ok: true; readonly literals: readonly LiteralValue[] }
  | { readonly ok: false; readonly diagnostic: Diagnostic };
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(engine): add shared type definitions"
```

---

### Task 7: Project cache

**Files:**
- Create: `src/engine/project-cache.ts`
- Create: `test/engine/project-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearProjectCache, getOrCreateProject } from "../../src/engine/project-cache";

describe("project cache", () => {
  const tmpdirs: string[] = [];

  afterEach(() => {
    clearProjectCache();
    for (const d of tmpdirs) rmSync(d, { recursive: true, force: true });
    tmpdirs.length = 0;
  });

  function makeFixture(name: string): { dir: string; tsconfigPath: string } {
    const dir = mkdtempSync(join(tmpdir(), `mintz-${name}-`));
    tmpdirs.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", strict: true },
        include: ["src/**/*"],
      }),
    );
    writeFileSync(join(dir, "src/index.ts"), 'export const x = "a" as const;');
    return { dir, tsconfigPath: join(dir, "tsconfig.json") };
  }

  test("walks up from a file to find tsconfig", () => {
    const { dir, tsconfigPath } = makeFixture("walk");
    const filePath = join(dir, "src/index.ts");
    const project = getOrCreateProject(undefined, filePath);
    expect(project.getCompilerOptions().target).toBeDefined();
    // Cache key reflects the actual tsconfig discovered.
    const project2 = getOrCreateProject(tsconfigPath, filePath);
    expect(project2).toBe(project);
  });

  test("uses explicit tsconfigPath if provided", () => {
    const { tsconfigPath } = makeFixture("explicit");
    const a = getOrCreateProject(tsconfigPath);
    const b = getOrCreateProject(tsconfigPath);
    expect(a).toBe(b); // cached
  });

  test("different tsconfigs produce different Project instances", () => {
    const a = makeFixture("a");
    const b = makeFixture("b");
    const pa = getOrCreateProject(a.tsconfigPath);
    const pb = getOrCreateProject(b.tsconfigPath);
    expect(pa).not.toBe(pb);
  });

  test("clearProjectCache resets the cache", () => {
    const { tsconfigPath } = makeFixture("clear");
    const a = getOrCreateProject(tsconfigPath);
    clearProjectCache();
    const b = getOrCreateProject(tsconfigPath);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/project-cache.test.ts`
Expected: FAIL — `src/engine/project-cache` does not exist.

- [ ] **Step 3: Write `src/engine/project-cache.ts`**

```ts
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Project } from "ts-morph";

const cache = new Map<string, Project>();

export function getOrCreateProject(
  tsconfigPath: string | undefined,
  filePath?: string,
): Project {
  const resolvedTsconfig = tsconfigPath
    ? resolve(tsconfigPath)
    : findTsconfig(filePath);

  const cacheKey = resolvedTsconfig ?? "<default>";
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const project = new Project(
    resolvedTsconfig
      ? { tsConfigFilePath: resolvedTsconfig }
      : { useInMemoryFileSystem: false },
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/engine/project-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/project-cache.ts test/engine/project-cache.test.ts
git commit -m "feat(engine): add project cache keyed by tsconfig"
```

---

### Task 8: Find `mint()` call sites by symbol identity

**Files:**
- Create: `src/engine/find-calls.ts`
- Create: `test/engine/find-calls.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { findMintCalls } from "../../src/engine/find-calls";

function makeProject(sources: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, code] of Object.entries(sources)) {
    project.createSourceFile(path, code);
  }
  return project;
}

describe("findMintCalls", () => {
  test("finds a default-import call", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts":
        'import mint from "/mintz/runtime";\nconst x = mint<"a" | "b">();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(1);
  });

  test("finds a named-import call", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts":
        'import { mint } from "/mintz/runtime";\nconst x = mint<"a">();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(1);
  });

  test("finds a renamed-import call", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts":
        'import { default as m } from "/mintz/runtime";\nconst x = m<"a">();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(1);
  });

  test("ignores a local function named mint that shadows the import", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts":
        'function mint() { return "local"; }\nconst x = mint();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(0);
  });

  test("finds multiple calls in the same file", () => {
    const project = makeProject({
      "/mintz/runtime.ts":
        "export default function mint<T>(values?: readonly T[]) { return values ?? []; }",
      "/src/index.ts":
        'import mint from "/mintz/runtime";\n' +
        'const a = mint<"x" | "y">();\n' +
        'const b = mint<1 | 2>();',
    });
    const file = project.getSourceFileOrThrow("/src/index.ts");
    const calls = findMintCalls(file, "/mintz/runtime");
    expect(calls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/find-calls.test.ts`
Expected: FAIL — `find-calls` not yet written.

- [ ] **Step 3: Write `src/engine/find-calls.ts`**

```ts
import {
  type CallExpression,
  type SourceFile,
  type Symbol as TsSymbol,
  SyntaxKind,
} from "ts-morph";

/**
 * Find every CallExpression in `sourceFile` whose callee resolves to mintz's
 * default export (or its named alias). Resolution is done via TypeScript's
 * symbol table, so renamed imports, re-exports, and shadowing are all handled
 * correctly.
 */
export function findMintCalls(
  sourceFile: SourceFile,
  mintzModulePath: string,
): readonly CallExpression[] {
  const mintSymbols = collectMintSymbols(sourceFile, mintzModulePath);
  if (mintSymbols.size === 0) return [];

  const result: CallExpression[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const sym = callee.getSymbol();
    if (!sym) continue;
    const aliased = unalias(sym);
    if (mintSymbols.has(aliased)) {
      result.push(call);
    }
  }
  return result;
}

function collectMintSymbols(
  sourceFile: SourceFile,
  mintzModulePath: string,
): Set<TsSymbol> {
  const symbols = new Set<TsSymbol>();
  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpec = decl.getModuleSpecifierValue();
    if (!matchesMintzModule(moduleSpec, mintzModulePath)) continue;

    const def = decl.getDefaultImport();
    if (def) {
      const sym = def.getSymbol();
      if (sym) symbols.add(unalias(sym));
    }
    for (const named of decl.getNamedImports()) {
      const propertyName = named.getNameNode().getText();
      const aliasNode = named.getAliasNode();
      const localName = aliasNode ? aliasNode.getText() : propertyName;
      // We want the symbol that *binds locally*; that's the local identifier.
      const localSym = (aliasNode ?? named.getNameNode()).getSymbol();
      if (localSym && (propertyName === "mint" || propertyName === "default")) {
        symbols.add(unalias(localSym));
      }
      void localName;
    }
  }
  return symbols;
}

function matchesMintzModule(spec: string, mintzPath: string): boolean {
  return spec === "mintz" || spec === mintzPath;
}

function unalias(sym: TsSymbol): TsSymbol {
  let cur = sym;
  // Walk through aliases (e.g. import-renames) to the originating symbol.
  for (let i = 0; i < 16; i++) {
    const aliased = cur.getAliasedSymbol?.();
    if (!aliased || aliased === cur) break;
    cur = aliased;
  }
  return cur;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/engine/find-calls.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/find-calls.ts test/engine/find-calls.test.ts
git commit -m "feat(engine): find mint call sites via symbol identity"
```

---

### Task 9: Resolve `T` to a literal union

**Files:**
- Create: `src/engine/resolve-type.ts`
- Create: `test/engine/resolve-type.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { Project, SyntaxKind } from "ts-morph";
import { resolveTypeToLiterals } from "../../src/engine/resolve-type";

function callTypeFromCode(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/src/index.ts", code);
  const call = file.getFirstDescendantByKindOrThrow(SyntaxKind.CallExpression);
  const typeArg = call.getTypeArguments()[0];
  if (!typeArg) throw new Error("expected a type argument");
  return { call, type: typeArg.getType() };
}

describe("resolveTypeToLiterals", () => {
  test("string literal union", () => {
    const { type } = callTypeFromCode('declare function mint<T>(): T; mint<"a" | "b">();');
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.literals).toEqual([
        { kind: "string", value: "a" },
        { kind: "string", value: "b" },
      ]);
    }
  });

  test("rejects open string", () => {
    const { type } = callTypeFromCode("declare function mint<T>(): T; mint<string>();");
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("OPEN_TYPE");
  });

  test("rejects mixed open + literal", () => {
    const { type } = callTypeFromCode(
      'declare function mint<T>(): T; mint<"a" | string>();',
    );
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("OPEN_TYPE");
  });

  test("rejects never", () => {
    const { type } = callTypeFromCode("declare function mint<T>(): T; mint<never>();");
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("EMPTY_UNION");
  });

  test("rejects object type", () => {
    const { type } = callTypeFromCode(
      "declare function mint<T>(): T; mint<{ a: 1 }>();",
    );
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic.code).toBe("NON_LITERAL_TYPE");
  });

  test("rejects object union", () => {
    const { type } = callTypeFromCode(
      "declare function mint<T>(): T; mint<{ kind: 'a' } | { kind: 'b' }>();",
    );
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostic.code).toBe("NON_LITERAL_TYPE");
      expect(r.diagnostic.suggestions?.[0]).toMatch(/indexed access/);
    }
  });

  test("numeric literal union", () => {
    const { type } = callTypeFromCode(
      "declare function mint<T>(): T; mint<1 | 2 | 3>();",
    );
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.literals.map((l) => (l as { value: number }).value)).toEqual([1, 2, 3]);
  });

  test("boolean true | false", () => {
    const { type } = callTypeFromCode(
      "declare function mint<T>(): T; mint<boolean>();",
    );
    // `boolean` in TypeScript is `true | false`; this is a finite union of literals.
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
  });

  test("null", () => {
    const { type } = callTypeFromCode(
      'declare function mint<T>(): T; mint<"a" | null>();',
    );
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
  });

  test("undefined", () => {
    const { type } = callTypeFromCode(
      'declare function mint<T>(): T; mint<"a" | undefined>();',
    );
    const r = resolveTypeToLiterals(type);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/resolve-type.test.ts`
Expected: FAIL — `resolve-type` not yet written.

- [ ] **Step 3: Write `src/engine/resolve-type.ts`**

```ts
import { type Type } from "ts-morph";
import type { Diagnostic } from "../errors";
import type { LiteralValue, Resolution } from "./types";

/**
 * Resolve a TypeScript Type to a flat list of literal values, or produce a
 * diagnostic if it cannot be enumerated.
 *
 * Returns members in the order TypeScript surfaces them. Sorting is the
 * classifier's job (classify.ts), not this function's.
 */
export function resolveTypeToLiterals(type: Type): Resolution {
  // Detect a `never` (empty union).
  if (type.isNever()) {
    return failure({
      code: "EMPTY_UNION",
      message: "T resolved to `never` (empty union); cannot enumerate.",
      suggestions: ["Did you mean to write an empty array literal `[] as const`?"],
      resolvedType: "never",
    });
  }

  // `boolean` IS a union of `true | false`; treat it specially BEFORE checking
  // unions so we can drill in (ts-morph treats boolean as non-union sometimes).
  const members = type.isUnion() ? type.getUnionTypes() : [type];

  const literals: LiteralValue[] = [];
  for (const m of members) {
    const lit = classifyMember(m);
    if (lit === "open") {
      return failure({
        code: "OPEN_TYPE",
        message: `T contains the open type \`${m.getText()}\`, which has infinite values and cannot be enumerated.`,
        resolvedType: type.getText(),
        suggestions: [
          `Use \`Extract<T, ${"<finite-union>"}>\` to keep only the literal members.`,
          "Refactor the source type so T is itself a finite literal union.",
        ],
      });
    }
    if (lit === "non-literal") {
      const isObject = isObjectish(m);
      return failure({
        code: "NON_LITERAL_TYPE",
        message: `T contains \`${m.getText()}\`, which is not a literal type.`,
        resolvedType: type.getText(),
        suggestions: isObject
          ? [
              "If T is a discriminated union of objects, use indexed access on the discriminator: " +
                "`mint<U['kind']>()`.",
              "If T is a single object type, mintz cannot enumerate it.",
            ]
          : ["Narrow T to a finite union of string/number/boolean/bigint/null/undefined literals."],
      });
    }
    literals.push(lit);
  }

  if (literals.length === 0) {
    return failure({
      code: "EMPTY_UNION",
      message: "T resolved to an empty union; cannot enumerate.",
      resolvedType: type.getText(),
    });
  }

  return { ok: true, literals };
}

type ClassifyResult = LiteralValue | "open" | "non-literal";

function classifyMember(t: Type): ClassifyResult {
  if (t.isStringLiteral()) {
    return { kind: "string", value: t.getLiteralValue() as string };
  }
  if (t.isNumberLiteral()) {
    return { kind: "number", value: t.getLiteralValue() as number };
  }
  if (t.isBooleanLiteral()) {
    // ts-morph exposes the literal value of true/false via getText.
    return { kind: "boolean", value: t.getText() === "true" };
  }
  if (t.compilerType.isLiteral() && typeof t.compilerType.value === "object") {
    // BigIntLiteralType: `value` is { negative, base10Value }
    const v = t.compilerType.value as { negative: boolean; base10Value: string };
    const big = (v.negative ? -1n : 1n) * BigInt(v.base10Value);
    return { kind: "bigint", value: big };
  }
  if ((t.compilerType.flags & /* TypeFlags.Null */ 65536) !== 0) {
    return { kind: "null" };
  }
  if ((t.compilerType.flags & /* TypeFlags.Undefined */ 32768) !== 0) {
    return { kind: "undefined" };
  }
  // Open types: `string`, `number`, `boolean`, `bigint`, `any`, `unknown`.
  if (t.isString() || t.isNumber() || t.isBoolean() || t.isAny() || t.isUnknown()) {
    return "open";
  }
  if ((t.compilerType.flags & /* TypeFlags.BigInt */ 64) !== 0) {
    // Open `bigint` (no value).
    return "open";
  }
  return "non-literal";
}

function isObjectish(t: Type): boolean {
  return t.isObject() || t.isClass() || t.isInterface() || t.isTuple() || t.isArray();
}

function failure(args: {
  code: string;
  message: string;
  resolvedType?: string;
  suggestions?: readonly string[];
}): Resolution {
  const diagnostic: Diagnostic = {
    severity: "error",
    code: args.code,
    message: args.message,
    file: "",
    line: 0,
    column: 0,
    sourceLine: "",
    caretLength: 1,
    resolvedType: args.resolvedType,
    suggestions: args.suggestions,
  };
  return { ok: false, diagnostic };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/engine/resolve-type.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/resolve-type.ts test/engine/resolve-type.test.ts
git commit -m "feat(engine): resolve T to literal values via type checker"
```

---

### Task 10: Classify and sort literals deterministically

**Files:**
- Create: `src/engine/classify.ts`
- Create: `test/engine/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { sortLiterals } from "../../src/engine/classify";
import type { LiteralValue } from "../../src/engine/types";

describe("sortLiterals", () => {
  test("strings sort by UTF-16 code-unit", () => {
    const input: LiteralValue[] = [
      { kind: "string", value: "café" },
      { kind: "string", value: "apple" },
      { kind: "string", value: "Banana" },
    ];
    const out = sortLiterals(input);
    // "Banana" (B = 0x42) < "apple" (a = 0x61) < "café" (c = 0x63)
    expect(out.map((l) => (l as { value: string }).value)).toEqual([
      "Banana",
      "apple",
      "café",
    ]);
  });

  test("numbers sort numerically including negatives", () => {
    const input: LiteralValue[] = [
      { kind: "number", value: 10 },
      { kind: "number", value: -1 },
      { kind: "number", value: 0 },
      { kind: "number", value: 2 },
    ];
    const out = sortLiterals(input);
    expect(out.map((l) => (l as { value: number }).value)).toEqual([-1, 0, 2, 10]);
  });

  test("booleans: false before true", () => {
    const input: LiteralValue[] = [
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
    ];
    const out = sortLiterals(input);
    expect(out).toEqual([
      { kind: "boolean", value: false },
      { kind: "boolean", value: true },
    ]);
  });

  test("bigints sort numerically", () => {
    const input: LiteralValue[] = [
      { kind: "bigint", value: 100n },
      { kind: "bigint", value: 1n },
      { kind: "bigint", value: 2n },
    ];
    const out = sortLiterals(input);
    expect(out.map((l) => (l as { value: bigint }).value)).toEqual([1n, 2n, 100n]);
  });

  test("mixed kinds: strings, numbers, bigints, booleans, null, undefined", () => {
    const input: LiteralValue[] = [
      { kind: "undefined" },
      { kind: "boolean", value: true },
      { kind: "null" },
      { kind: "string", value: "z" },
      { kind: "string", value: "a" },
      { kind: "number", value: 1 },
      { kind: "bigint", value: 2n },
    ];
    const out = sortLiterals(input);
    expect(out).toEqual([
      { kind: "string", value: "a" },
      { kind: "string", value: "z" },
      { kind: "number", value: 1 },
      { kind: "bigint", value: 2n },
      { kind: "boolean", value: true },
      { kind: "null" },
      { kind: "undefined" },
    ]);
  });

  test("dedupes identical literals (TS would already, but defense in depth)", () => {
    const input: LiteralValue[] = [
      { kind: "string", value: "a" },
      { kind: "string", value: "a" },
      { kind: "string", value: "b" },
    ];
    const out = sortLiterals(input);
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/classify.test.ts`
Expected: FAIL — `classify` not yet written.

- [ ] **Step 3: Write `src/engine/classify.ts`**

```ts
import type { LiteralValue } from "./types";

const KIND_ORDER: Record<LiteralValue["kind"], number> = {
  string: 0,
  number: 1,
  bigint: 2,
  boolean: 3,
  null: 4,
  undefined: 5,
};

export function sortLiterals(input: readonly LiteralValue[]): readonly LiteralValue[] {
  const seen = new Set<string>();
  const deduped: LiteralValue[] = [];
  for (const lit of input) {
    const key = stableKey(lit);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(lit);
  }
  return deduped.slice().sort(compare);
}

function compare(a: LiteralValue, b: LiteralValue): number {
  const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (ko !== 0) return ko;
  switch (a.kind) {
    case "string":
      // UTF-16 code-unit order matches JS default `<` operator.
      return a.value < (b as typeof a).value ? -1 : a.value > (b as typeof a).value ? 1 : 0;
    case "number":
      return a.value - (b as typeof a).value;
    case "bigint": {
      const bv = (b as typeof a).value;
      return a.value < bv ? -1 : a.value > bv ? 1 : 0;
    }
    case "boolean":
      // false (0) before true (1)
      return Number(a.value) - Number((b as typeof a).value);
    case "null":
    case "undefined":
      return 0;
  }
}

function stableKey(lit: LiteralValue): string {
  switch (lit.kind) {
    case "string":
      return `s:${lit.value}`;
    case "number":
      return `n:${lit.value}`;
    case "bigint":
      return `i:${lit.value.toString()}`;
    case "boolean":
      return `b:${lit.value}`;
    case "null":
      return "u";
    case "undefined":
      return "v";
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/engine/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/classify.ts test/engine/classify.test.ts
git commit -m "feat(engine): deterministic literal sort and dedup"
```

---

### Task 11: Emit literal arrays as TypeScript text

**Files:**
- Create: `src/engine/emit.ts`
- Create: `test/engine/emit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { emitInlineArray, emitWrappedCall } from "../../src/engine/emit";
import type { LiteralValue } from "../../src/engine/types";

describe("emitInlineArray (state 3)", () => {
  test("strings", () => {
    const lits: LiteralValue[] = [
      { kind: "string", value: "a" },
      { kind: "string", value: "b" },
    ];
    expect(emitInlineArray(lits)).toBe('["a", "b"] as const');
  });

  test("strings with quotes are escaped", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: 'has"quote' }];
    expect(emitInlineArray(lits)).toBe('["has\\"quote"] as const');
  });

  test("strings with backslashes are escaped", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: "a\\b" }];
    expect(emitInlineArray(lits)).toBe('["a\\\\b"] as const');
  });

  test("strings with newlines are escaped", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: "a\nb" }];
    expect(emitInlineArray(lits)).toBe('["a\\nb"] as const');
  });

  test("non-ASCII strings preserved", () => {
    const lits: LiteralValue[] = [{ kind: "string", value: "café" }];
    expect(emitInlineArray(lits)).toBe('["café"] as const');
  });

  test("numbers, bigints, booleans, null, undefined", () => {
    const lits: LiteralValue[] = [
      { kind: "number", value: -1 },
      { kind: "number", value: 0 },
      { kind: "bigint", value: 100n },
      { kind: "boolean", value: true },
      { kind: "null" },
      { kind: "undefined" },
    ];
    expect(emitInlineArray(lits)).toBe("[-1, 0, 100n, true, null, undefined] as const");
  });

  test("breaks long arrays into multi-line form (>80 chars)", () => {
    const lits: LiteralValue[] = Array.from({ length: 6 }, (_, i) => ({
      kind: "string" as const,
      value: `event.name.${"x".repeat(8)}.${i}`,
    }));
    const out = emitInlineArray(lits);
    expect(out).toContain("\n");
    expect(out.endsWith("] as const")).toBe(true);
  });
});

describe("emitWrappedCall (state 2)", () => {
  test("preserves the type argument text and adds the values arg", () => {
    const out = emitWrappedCall(
      "ClientToServerEvent['event']",
      [{ kind: "string", value: "a" }, { kind: "string", value: "b" }],
    );
    expect(out).toBe('mint<ClientToServerEvent[\'event\']>(["a", "b"])');
  });

  test("uses the original callee text when provided (alias support)", () => {
    const out = emitWrappedCall(
      "Status",
      [{ kind: "string", value: "ok" }],
      "m", // user wrote `import { default as m } from "mintz"`
    );
    expect(out).toBe('m<Status>(["ok"])');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/emit.test.ts`
Expected: FAIL — `emit` not yet written.

- [ ] **Step 3: Write `src/engine/emit.ts`**

```ts
import type { LiteralValue } from "./types";

const SINGLE_LINE_LIMIT = 80;

export function emitInlineArray(lits: readonly LiteralValue[]): string {
  const parts = lits.map(emitLiteral);
  const single = `[${parts.join(", ")}] as const`;
  if (single.length <= SINGLE_LINE_LIMIT) return single;
  return `[\n  ${parts.join(",\n  ")},\n] as const`;
}

export function emitWrappedCall(
  typeArgText: string,
  lits: readonly LiteralValue[],
  callee: string = "mint",
): string {
  const parts = lits.map(emitLiteral);
  const arrSingle = `[${parts.join(", ")}]`;
  const arr =
    arrSingle.length + callee.length + typeArgText.length + 4 <= SINGLE_LINE_LIMIT
      ? arrSingle
      : `[\n  ${parts.join(",\n  ")},\n]`;
  return `${callee}<${typeArgText}>(${arr})`;
}

function emitLiteral(lit: LiteralValue): string {
  switch (lit.kind) {
    case "string":
      return JSON.stringify(lit.value);
    case "number":
      return String(lit.value);
    case "bigint":
      return `${lit.value.toString()}n`;
    case "boolean":
      return String(lit.value);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/engine/emit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/emit.ts test/engine/emit.test.ts
git commit -m "feat(engine): emit literal arrays as TypeScript text"
```

---

### Task 12: Main `transform()` integration

**Files:**
- Create: `src/engine/index.ts`
- Create: `test/engine/transform.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { transform } from "../../src/engine";
import { resolve } from "node:path";

const MINTZ_RUNTIME = "/virtual/mintz/runtime";
const MINTZ_RUNTIME_SRC =
  "export default function mint<T>(values?: readonly T[]) { return (values ?? []) as readonly T[]; }";

function setup(userSource: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(`${MINTZ_RUNTIME}.ts`, MINTZ_RUNTIME_SRC);
  const file = project.createSourceFile("/src/user.ts", userSource);
  return { project, file };
}

describe("transform", () => {
  test("rewrites a state-1 call to inline array (build mode)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` +
      'const events = mint<"a" | "b">();\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain('["a", "b"] as const');
    expect(result.code).not.toContain('mint<"a" | "b">()');
  });

  test("rewrites a state-1 call to wrapped form (codegen mode)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` +
      'const events = mint<"a" | "b">();\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "wrapped",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(true);
    expect(result.code).toContain('mint<"a" | "b">(["a", "b"])');
  });

  test("inlines a state-2 call (already codegen'd) in inline mode", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` +
      'const events = mint<"a" | "b">(["stale"]);\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.code).toContain('["a", "b"] as const');
    expect(result.code).not.toContain('"stale"');
  });

  test("re-resolves a state-2 call in wrapped mode (drift detection)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` +
      'const events = mint<"a" | "b">(["a"]);\n'; // stale
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "wrapped",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(true);
    expect(result.code).toContain('mint<"a" | "b">(["a", "b"])');
  });

  test("returns modified=false when nothing changes (idempotent)", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` +
      'const events = mint<"a" | "b">(["a", "b"]);\n';
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "wrapped",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(false);
    expect(result.code).toBe(userSource);
  });

  test("emits a diagnostic for open string", () => {
    const userSource =
      `import mint from "${MINTZ_RUNTIME}";\n` +
      "const x = mint<string>();\n";
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("OPEN_TYPE");
    expect(result.modified).toBe(false);
  });

  test("fast-skip via missing import: no transform on unrelated files", () => {
    const userSource = "export const greet = (n: string) => `hi ${n}`;\n";
    const { project } = setup(userSource);
    const result = transform({
      source: userSource,
      filename: "/src/user.ts",
      project,
      mode: "inline",
      mintzModulePath: MINTZ_RUNTIME,
    });
    expect(result.modified).toBe(false);
    expect(result.diagnostics).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/transform.test.ts`
Expected: FAIL — `engine/index` not yet written.

- [ ] **Step 3: Write `src/engine/index.ts`**

```ts
import { type CallExpression, type SourceFile, SyntaxKind } from "ts-morph";
import type { Diagnostic } from "../errors";
import { sortLiterals } from "./classify";
import { emitInlineArray, emitWrappedCall } from "./emit";
import { findMintCalls } from "./find-calls";
import { resolveTypeToLiterals } from "./resolve-type";
import type { LiteralValue, TransformResult } from "./types";

export interface TransformOptions {
  readonly source: string;
  readonly filename: string;
  readonly project: import("ts-morph").Project;
  readonly mode: "inline" | "wrapped";
  /** Module path mintz resolves from. Default: "mintz". */
  readonly mintzModulePath?: string;
}

export function transform(opts: TransformOptions): TransformResult {
  // Fast-skip: avoid AST parse if file doesn't even mention "mintz".
  const mintzMod = opts.mintzModulePath ?? "mintz";
  if (!opts.source.includes(mintzMod)) {
    return { code: opts.source, modified: false, diagnostics: [] };
  }

  // Re-use or create the source file in the project.
  const existing = opts.project.getSourceFile(opts.filename);
  const file = existing
    ? (existing.replaceWithText(opts.source), opts.project.getSourceFileOrThrow(opts.filename))
    : opts.project.createSourceFile(opts.filename, opts.source, { overwrite: true });

  const calls = findMintCalls(file, mintzMod);
  if (calls.length === 0) {
    return { code: file.getFullText(), modified: false, diagnostics: [] };
  }

  // Reject calls in declaration files.
  if (opts.filename.endsWith(".d.ts")) {
    return {
      code: opts.source,
      modified: false,
      diagnostics: [
        callDiagnostic(file, calls[0]!, {
          code: "DECL_FILE",
          message: "mint<T>() cannot be used in declaration (.d.ts) files.",
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  // Process calls in reverse order so earlier text replacements don't shift later positions.
  const sortedCalls = calls.slice().sort((a, b) => b.getStart() - a.getStart());

  for (const call of sortedCalls) {
    const typeArg = call.getTypeArguments()[0];
    if (!typeArg) {
      diagnostics.push(
        callDiagnostic(file, call, {
          code: "MISSING_TYPE_ARG",
          message: "mint<T>() requires a type argument.",
        }),
      );
      continue;
    }

    const resolution = resolveTypeToLiterals(typeArg.getType());
    if (!resolution.ok) {
      diagnostics.push(enrichDiagnostic(file, call, resolution.diagnostic));
      continue;
    }

    const sorted = sortLiterals(resolution.literals);
    const replacement = renderReplacement(call, typeArg.getText(), sorted, opts.mode);
    if (replacement !== call.getText()) {
      call.replaceWithText(replacement);
    }
  }

  const newText = file.getFullText();
  return {
    code: newText,
    modified: newText !== opts.source && diagnostics.every((d) => d.severity !== "error"),
    diagnostics,
  };
}

function renderReplacement(
  call: CallExpression,
  typeArgText: string,
  literals: readonly LiteralValue[],
  mode: "inline" | "wrapped",
): string {
  if (mode === "inline") {
    return emitInlineArray(literals);
  }
  // Wrapped (codegen) mode: keep the user's callee identifier (handles
  // renamed imports like `import { default as m } from "mintz"`).
  const callee = call.getExpression().getText();
  return emitWrappedCall(typeArgText, literals, callee);
}

function callDiagnostic(
  file: SourceFile,
  call: CallExpression,
  d: Pick<Diagnostic, "code" | "message">,
): Diagnostic {
  const start = call.getStart();
  const { line, column } = file.getLineAndColumnAtPos(start);
  const sourceLine = lineAtPos(file.getFullText(), start);
  return {
    severity: "error",
    code: d.code,
    message: d.message,
    file: file.getFilePath(),
    line,
    column,
    sourceLine,
    caretLength: call.getWidth(),
  };
}

function enrichDiagnostic(file: SourceFile, call: CallExpression, base: Diagnostic): Diagnostic {
  const start = call.getStart();
  const { line, column } = file.getLineAndColumnAtPos(start);
  return {
    ...base,
    file: file.getFilePath(),
    line,
    column,
    sourceLine: lineAtPos(file.getFullText(), start),
    caretLength: call.getWidth(),
  };
}

function lineAtPos(text: string, pos: number): string {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const end = text.indexOf("\n", pos);
  return text.slice(start, end === -1 ? text.length : end);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/engine/transform.test.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Run all tests + typecheck**

Run: `bun test && bun run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/engine/index.ts test/engine/transform.test.ts
git commit -m "feat(engine): integrate find-resolve-classify-emit into transform()"
```

---

## Phase 3 — Engine fixtures (snapshot tests)

### Task 13: Fixture-driven test harness + first fixture (string union)

**Files:**
- Create: `test/engine/fixtures.test.ts`
- Create: `test/fixtures/01-string-union/input.ts`
- Create: `test/fixtures/01-string-union/expected.ts`
- Create: `test/fixtures/01-string-union/tsconfig.json`

- [ ] **Step 1: Write the harness**

```ts
// test/engine/fixtures.test.ts
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project } from "ts-morph";
import { transform } from "../../src/engine";

const FIXTURES_DIR = resolve(import.meta.dir, "..", "fixtures");
const projects = new Map<string, Project>();

afterAll(() => projects.clear());

function projectFor(fixtureDir: string): Project {
  const tsconfigPath = join(fixtureDir, "tsconfig.json");
  let project = projects.get(tsconfigPath);
  if (!project) {
    project = new Project({
      tsConfigFilePath: tsconfigPath,
      skipAddingFilesFromTsConfig: false,
    });
    projects.set(tsconfigPath, project);
  }
  return project;
}

describe("engine fixtures (success)", () => {
  const successDirs = readdirSync(FIXTURES_DIR)
    .filter((d) => d !== "error" && !d.startsWith("."))
    .sort();

  for (const fixtureName of successDirs) {
    const dir = join(FIXTURES_DIR, fixtureName);
    test(fixtureName, () => {
      const inputPath = join(dir, "input.ts");
      const expectedPath = join(dir, "expected.ts");
      const input = readFileSync(inputPath, "utf8");
      const expected = readFileSync(expectedPath, "utf8");
      const result = transform({
        source: input,
        filename: inputPath,
        project: projectFor(dir),
        mode: "inline",
        mintzModulePath: "mintz",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBe(expected);
    });
  }
});

describe("engine fixtures (errors)", () => {
  const errorDir = join(FIXTURES_DIR, "error");
  if (!existsSync(errorDir)) return;
  const errorDirs = readdirSync(errorDir).sort();

  for (const fixtureName of errorDirs) {
    const dir = join(errorDir, fixtureName);
    test(`error/${fixtureName}`, () => {
      const inputPath = join(dir, "input.ts");
      const expectedCodePath = join(dir, "expected-code.txt");
      const input = readFileSync(inputPath, "utf8");
      const expectedCode = readFileSync(expectedCodePath, "utf8").trim();
      const result = transform({
        source: input,
        filename: inputPath,
        project: projectFor(dir),
        mode: "inline",
        mintzModulePath: "mintz",
      });
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]!.code).toBe(expectedCode);
    });
  }
});
```

- [ ] **Step 2: Add the first success fixture (`01-string-union`)**

Write `test/fixtures/01-string-union/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "paths": { "mintz": ["../../../src/runtime.ts"] }
  },
  "include": ["input.ts"]
}
```

Write `test/fixtures/01-string-union/input.ts`:

```ts
import mint from "mintz";

export const colors = mint<"red" | "green" | "blue">();
```

Write `test/fixtures/01-string-union/expected.ts`:

```ts
import mint from "mintz";

export const colors = ["blue", "green", "red"] as const;
```

- [ ] **Step 3: Run the harness on the first fixture**

Run: `bun test test/engine/fixtures.test.ts`
Expected: PASS — `01-string-union` green; "errors" describe is empty (no fixtures yet).

- [ ] **Step 4: Commit**

```bash
git add test/engine/fixtures.test.ts test/fixtures/01-string-union/
git commit -m "test(engine): fixture harness with string-union case"
```

---

### Task 14: More success fixtures — numbers, bigints, booleans, null/undefined

**Files:**
- Create: `test/fixtures/02-number-union/{input,expected,tsconfig}.{ts,json}`
- Create: `test/fixtures/03-boolean-null-undefined/...`
- Create: `test/fixtures/04-bigint-union/...`

- [ ] **Step 1: Add `02-number-union`**

`tsconfig.json` (same shape as Task 13's). `input.ts`:
```ts
import mint from "mintz";
export const codes = mint<200 | 404 | 500 | -1 | 0>();
```
`expected.ts`:
```ts
import mint from "mintz";
export const codes = [-1, 0, 200, 404, 500] as const;
```

- [ ] **Step 2: Add `03-boolean-null-undefined`**

`input.ts`:
```ts
import mint from "mintz";
export const flags = mint<boolean | null | undefined>();
```
`expected.ts`:
```ts
import mint from "mintz";
export const flags = [false, true, null, undefined] as const;
```

- [ ] **Step 3: Add `04-bigint-union`**

`input.ts`:
```ts
import mint from "mintz";
export const bigs = mint<100n | 1n | 2n>();
```
`expected.ts`:
```ts
import mint from "mintz";
export const bigs = [1n, 2n, 100n] as const;
```

- [ ] **Step 4: Run the fixtures**

Run: `bun test test/engine/fixtures.test.ts`
Expected: 4 success fixtures all PASS.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/02-number-union/ test/fixtures/03-boolean-null-undefined/ test/fixtures/04-bigint-union/
git commit -m "test(engine): add number/boolean/null/undefined/bigint fixtures"
```

---

### Task 15: Enum fixtures (numeric and string)

**Files:**
- Create: `test/fixtures/05-numeric-enum/...`
- Create: `test/fixtures/06-string-enum/...`

- [ ] **Step 1: Add `05-numeric-enum`**

`input.ts`:
```ts
import mint from "mintz";

enum Direction { North, South, East, West }

export const dirValues = mint<Direction>();
export const dirNames = mint<keyof typeof Direction>();
```
`expected.ts`:
```ts
import mint from "mintz";

enum Direction { North, South, East, West }

export const dirValues = [0, 1, 2, 3] as const;
export const dirNames = ["East", "North", "South", "West"] as const;
```

- [ ] **Step 2: Add `06-string-enum`**

`input.ts`:
```ts
import mint from "mintz";

enum Color {
  Red = "red",
  Blue = "blue",
  Green = "green",
}

export const values = mint<Color>();
export const names = mint<keyof typeof Color>();
```
`expected.ts`:
```ts
import mint from "mintz";

enum Color {
  Red = "red",
  Blue = "blue",
  Green = "green",
}

export const values = ["blue", "green", "red"] as const;
export const names = ["Blue", "Green", "Red"] as const;
```

- [ ] **Step 3: Run**

Run: `bun test test/engine/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/05-numeric-enum/ test/fixtures/06-string-enum/
git commit -m "test(engine): add numeric and string enum fixtures"
```

---

### Task 16: Indexed-access (wire-protocol) and `keyof typeof`

**Files:**
- Create: `test/fixtures/07-indexed-access/...`
- Create: `test/fixtures/08-keyof-typeof-const/...`

- [ ] **Step 1: Add `07-indexed-access`**

`input.ts`:
```ts
import mint from "mintz";

type ClientToServerEvent =
  | { kind: "lobby.reaction"; payload: number }
  | { kind: "system.ping" }
  | { kind: "round.submit"; turn: number };

export const eventNames = mint<ClientToServerEvent["kind"]>();
```
`expected.ts`:
```ts
import mint from "mintz";

type ClientToServerEvent =
  | { kind: "lobby.reaction"; payload: number }
  | { kind: "system.ping" }
  | { kind: "round.submit"; turn: number };

export const eventNames = ["lobby.reaction", "round.submit", "system.ping"] as const;
```

- [ ] **Step 2: Add `08-keyof-typeof-const`**

`input.ts`:
```ts
import mint from "mintz";

const HttpStatus = { Ok: 200, NotFound: 404, ServerError: 500 } as const;

export const names = mint<keyof typeof HttpStatus>();
export const values = mint<typeof HttpStatus[keyof typeof HttpStatus]>();
```
`expected.ts`:
```ts
import mint from "mintz";

const HttpStatus = { Ok: 200, NotFound: 404, ServerError: 500 } as const;

export const names = ["NotFound", "Ok", "ServerError"] as const;
export const values = [200, 404, 500] as const;
```

- [ ] **Step 3: Run**

Run: `bun test test/engine/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/07-indexed-access/ test/fixtures/08-keyof-typeof-const/
git commit -m "test(engine): add indexed-access and keyof-typeof fixtures"
```

---

### Task 17: `Exclude`, template literals, mixed kinds

**Files:**
- Create: `test/fixtures/09-exclude/...`
- Create: `test/fixtures/10-template-literal/...`
- Create: `test/fixtures/11-mixed-kinds/...`

- [ ] **Step 1: Add `09-exclude`**

`input.ts`:
```ts
import mint from "mintz";

type Status = "active" | "pending" | "deprecated" | "archived";

export const live = mint<Exclude<Status, "deprecated" | "archived">>();
```
`expected.ts`:
```ts
import mint from "mintz";

type Status = "active" | "pending" | "deprecated" | "archived";

export const live = ["active", "pending"] as const;
```

- [ ] **Step 2: Add `10-template-literal`**

`input.ts`:
```ts
import mint from "mintz";

export const events = mint<`evt.${"a" | "b"}.${"start" | "end"}`>();
```
`expected.ts`:
```ts
import mint from "mintz";

export const events = ["evt.a.end", "evt.a.start", "evt.b.end", "evt.b.start"] as const;
```

- [ ] **Step 3: Add `11-mixed-kinds`**

`input.ts`:
```ts
import mint from "mintz";

export const mixed = mint<"a" | 1 | true | null | undefined | 2n>();
```
`expected.ts`:
```ts
import mint from "mintz";

export const mixed = ["a", 1, 2n, true, null, undefined] as const;
```

- [ ] **Step 4: Run**

Run: `bun test test/engine/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/09-exclude/ test/fixtures/10-template-literal/ test/fixtures/11-mixed-kinds/
git commit -m "test(engine): add Exclude, template literal, mixed kinds fixtures"
```

---

### Task 18: Edge fixtures — renames, re-exports, JSX, comments, multiple, cross-file, state-2

**Files:**
- Create: `test/fixtures/12-renamed-import/...`
- Create: `test/fixtures/13-re-export-barrel/...`
- Create: `test/fixtures/14-jsx-attribute/...`
- Create: `test/fixtures/15-comment-preservation/...`
- Create: `test/fixtures/16-multiple-calls/...`
- Create: `test/fixtures/17-cross-file/...`
- Create: `test/fixtures/18-already-codegend/...`

- [ ] **Step 1: Add `12-renamed-import`**

`input.ts`:
```ts
import { default as m } from "mintz";

export const x = m<"a" | "b">();
```
`expected.ts`:
```ts
import { default as m } from "mintz";

export const x = ["a", "b"] as const;
```

- [ ] **Step 2: Add `13-re-export-barrel`**

`input.ts`:
```ts
import mint from "mintz";

export { mint as M };

export const x = mint<"x" | "y">();
```
`expected.ts`:
```ts
import mint from "mintz";

export { mint as M };

export const x = ["x", "y"] as const;
```

- [ ] **Step 3: Add `14-jsx-attribute`** (use a `.tsx` extension)

`tsconfig.json` for this fixture must include `"jsx": "react-jsx"`. `input.tsx`:
```tsx
import mint from "mintz";

const colors = mint<"red" | "green" | "blue">();

export function Picker() {
  return <select>{colors.map((c) => <option key={c} value={c}>{c}</option>)}</select>;
}
```

`expected.tsx`:
```tsx
import mint from "mintz";

const colors = ["blue", "green", "red"] as const;

export function Picker() {
  return <select>{colors.map((c) => <option key={c} value={c}>{c}</option>)}</select>;
}
```

The harness must be extended to detect `.tsx` files; update `test/engine/fixtures.test.ts` to pick `input.tsx` if present (instead of `input.ts`) and likewise for `expected.tsx`. Add this small change:

```ts
function pickFile(dir: string, base: string): string {
  const tsx = join(dir, `${base}.tsx`);
  const ts = join(dir, `${base}.ts`);
  return existsSync(tsx) ? tsx : ts;
}
// then replace inputPath/expectedPath construction with pickFile(dir, "input") / pickFile(dir, "expected")
```

- [ ] **Step 4: Add `15-comment-preservation`**

`input.ts`:
```ts
import mint from "mintz";

/** All event names accepted by the server. */
export const events = mint<"start" | "stop">();
```
`expected.ts`:
```ts
import mint from "mintz";

/** All event names accepted by the server. */
export const events = ["start", "stop"] as const;
```

- [ ] **Step 5: Add `16-multiple-calls`**

`input.ts`:
```ts
import mint from "mintz";

export const a = mint<"x" | "y">();
export const b = mint<1 | 2>();
export const c = mint<boolean>();
```
`expected.ts`:
```ts
import mint from "mintz";

export const a = ["x", "y"] as const;
export const b = [1, 2] as const;
export const c = [false, true] as const;
```

- [ ] **Step 6: Add `17-cross-file`**

`input.ts`:
```ts
import mint from "mintz";
import type { Status } from "./types";

export const statuses = mint<Status>();
```
Also create `test/fixtures/17-cross-file/types.ts`:
```ts
export type Status = "active" | "pending" | "archived";
```
`expected.ts`:
```ts
import mint from "mintz";
import type { Status } from "./types";

export const statuses = ["active", "archived", "pending"] as const;
```

The fixture's `tsconfig.json` must include `"types.ts"` in `include`.

- [ ] **Step 7: Add `18-already-codegend`** (state-2 input → state-3 output)

`input.ts`:
```ts
import mint from "mintz";

export const x = mint<"a" | "b">(["stale"]);
```
`expected.ts`:
```ts
import mint from "mintz";

export const x = ["a", "b"] as const;
```

- [ ] **Step 8: Run all fixtures**

Run: `bun test test/engine/fixtures.test.ts`
Expected: all 18 success fixtures PASS.

- [ ] **Step 9: Commit**

```bash
git add test/engine/fixtures.test.ts test/fixtures/12-renamed-import/ test/fixtures/13-re-export-barrel/ test/fixtures/14-jsx-attribute/ test/fixtures/15-comment-preservation/ test/fixtures/16-multiple-calls/ test/fixtures/17-cross-file/ test/fixtures/18-already-codegend/
git commit -m "test(engine): rename/re-export/JSX/comment/multi/cross-file/state-2 fixtures"
```

---

### Task 19: Error fixtures

**Files:**
- Create: `test/fixtures/error/01-open-string/...` through `error/09-d-ts-call/...`

- [ ] **Step 1: Add error fixtures**

For each error fixture, create:
- `input.ts` (or `input.d.ts` for `09-d-ts-call`)
- `tsconfig.json` (paths: `mintz` → runtime)
- `expected-code.txt` containing the expected diagnostic code

| Dir | input.ts | expected-code.txt |
|---|---|---|
| `error/01-open-string` | `import mint from "mintz"; mint<string>();` | `OPEN_TYPE` |
| `error/02-string-mixed` | `import mint from "mintz"; mint<"a" \| string>();` | `OPEN_TYPE` |
| `error/03-never` | `import mint from "mintz"; mint<never>();` | `EMPTY_UNION` |
| `error/04-infinite-template` | `import mint from "mintz"; mint<\`${string}_${string}\`>();` | `OPEN_TYPE` |
| `error/05-object-type` | `import mint from "mintz"; mint<{ a: 1 }>();` | `NON_LITERAL_TYPE` |
| `error/06-object-union` | `import mint from "mintz"; type U = {kind:"a"}\|{kind:"b"}; mint<U>();` | `NON_LITERAL_TYPE` |
| `error/07-generic-param` | `import mint from "mintz"; export function f<T extends string>() { return mint<T>(); }` | `OPEN_TYPE` |
| `error/08-any` | `import mint from "mintz"; mint<any>();` | `OPEN_TYPE` |
| `error/09-d-ts-call` | (`input.d.ts`) `import mint from "mintz"; declare const x: ReturnType<typeof mint<"a">>;` | `DECL_FILE` |

For `09-d-ts-call`, the harness must look for `input.d.ts` if neither `input.ts` nor `input.tsx` exists. Update `pickFile` accordingly.

- [ ] **Step 2: Run the error fixtures**

Run: `bun test test/engine/fixtures.test.ts`
Expected: all 9 error fixtures PASS.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/error/
git commit -m "test(engine): add error fixtures (open types, object union, d.ts, etc.)"
```

---

## Phase 4 — Bun plugin

### Task 20: Bun plugin factory

**Files:**
- Create: `src/bun/index.ts`

- [ ] **Step 1: Write `src/bun/index.ts`**

```ts
import type { BunPlugin } from "bun";
import { transform } from "../engine";
import { getOrCreateProject } from "../engine/project-cache";
import { formatDiagnostic } from "../errors";

export interface MintzPluginOptions {
  /** Path to tsconfig.json. Default: walk up from each file. */
  readonly tsconfig?: string;
  /** Override default file filter. */
  readonly include?: RegExp;
  /** Module name to detect imports of. Default: "mintz". */
  readonly mintzModulePath?: string;
}

export default function mintzPlugin(opts: MintzPluginOptions = {}): BunPlugin {
  const filter = opts.include ?? /\.[mc]?tsx?$/;
  const moduleName = opts.mintzModulePath ?? "mintz";

  return {
    name: "mintz",
    setup(build) {
      build.onLoad({ filter, namespace: "file" }, async ({ path }) => {
        const source = await Bun.file(path).text();
        if (!source.includes(moduleName)) return;

        const project = getOrCreateProject(opts.tsconfig, path);
        const result = transform({
          source,
          filename: path,
          project,
          mode: "inline",
          mintzModulePath: moduleName,
        });

        const errors = result.diagnostics.filter((d) => d.severity === "error");
        if (errors.length > 0) {
          throw new Error(errors.map((d) => formatDiagnostic(d)).join("\n\n"));
        }
        for (const d of result.diagnostics) {
          if (d.severity === "warning") console.warn(formatDiagnostic(d));
        }
        if (!result.modified) return;
        return {
          contents: result.code,
          loader: pickLoader(path),
        };
      });
    },
  };
}

function pickLoader(path: string): "ts" | "tsx" {
  return /tsx$/i.test(path) ? "tsx" : "ts";
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/bun/index.ts
git commit -m "feat(bun): add Bun plugin factory for build and preload modes"
```

---

### Task 21: Bun plugin integration test

**Files:**
- Create: `test/bun-plugin.test.ts`

- [ ] **Step 1: Write the test**

```ts
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
      'console.log(events.length);',
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
    try {
      const result = await Bun.build({
        entrypoints: [entry],
        outdir: join(dir, "dist"),
        plugins: [mintzPlugin({ tsconfig: join(dir, "tsconfig.json") })],
        target: "bun",
      });
      expect(result.success).toBe(false);
      const allLogs = result.logs.map((l) => String(l)).join("\n");
      expect(allLogs).toContain("OPEN_TYPE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test test/bun-plugin.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 3: Commit**

```bash
git add test/bun-plugin.test.ts
git commit -m "test(bun): integration tests for the Bun plugin"
```

---

## Phase 5 — CLI

### Task 22: CLI skeleton (citty)

**Files:**
- Create: `src/cli/index.ts`

- [ ] **Step 1: Write the CLI entrypoint**

```ts
#!/usr/bin/env node
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "mintz",
    version: "0.0.0",
    description:
      "Rewrite mint<T>() calls to embed runtime literal arrays from your TypeScript types.",
  },
  args: {
    paths: {
      type: "positional",
      description: "Glob patterns of files to process. Default: src/**/*.{ts,tsx,mts,cts}",
      required: false,
    },
    check: {
      type: "boolean",
      description: "Read-only; exit non-zero if any file would change.",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Print diffs but don't write.",
      default: false,
    },
    watch: {
      type: "boolean",
      description: "Re-run on file changes.",
      default: false,
    },
    tsconfig: {
      type: "string",
      description: "Path to tsconfig.json (default: walk up from cwd).",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Emit diagnostics as newline-delimited JSON.",
      default: false,
    },
    silent: {
      type: "boolean",
      description: "Suppress informational stdout.",
      default: false,
    },
  },
  async run({ args }) {
    const paths = (args._ as string[]) ?? [];
    const { runRewrite } = await import("./rewrite");
    const { runCheck } = await import("./check");
    const { runWatch } = await import("./watch");

    const opts = {
      paths,
      tsconfig: args.tsconfig as string | undefined,
      json: args.json as boolean,
      silent: args.silent as boolean,
      dryRun: args["dry-run"] as boolean,
    };

    if (args.check) {
      process.exit(await runCheck(opts));
    } else if (args.watch) {
      process.exit(await runWatch(opts));
    } else {
      process.exit(await runRewrite(opts));
    }
  },
});

runMain(main);
```

- [ ] **Step 2: Verify the file at least parses**

Run: `bun run typecheck`
Expected: errors about missing `./rewrite`, `./check`, `./watch`. We'll create them in Tasks 23–25.

For now, create stubs to keep the typecheck green:

Write `src/cli/rewrite.ts`, `src/cli/check.ts`, `src/cli/watch.ts` each with:
```ts
export async function runRewrite(opts: { paths: string[] }): Promise<number> { void opts; return 0; }
```
(Adjust function name per file: `runRewrite`, `runCheck`, `runWatch`.)

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts src/cli/rewrite.ts src/cli/check.ts src/cli/watch.ts
git commit -m "feat(cli): add citty-based CLI skeleton with stub subcommands"
```

---

### Task 23: File discovery + tsconfig walking

**Files:**
- Create: `src/cli/discover.ts`
- Create: `test/cli/discover.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFiles } from "../../src/cli/discover";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "mintz-discover-"));
  dirs.push(root);
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "// a");
  writeFileSync(join(root, "src", "b.tsx"), "// b");
  writeFileSync(join(root, "src", "c.mts"), "// c");
  writeFileSync(join(root, "src", "d.cts"), "// d");
  writeFileSync(join(root, "src", "e.js"), "// e — must NOT be discovered");
  writeFileSync(join(root, "src", "deep", "f.ts"), "// f");
  return root;
}

describe("discoverFiles", () => {
  test("default: src/**/*.{ts,tsx,mts,cts}", async () => {
    const root = fixture();
    const files = await discoverFiles({ cwd: root, patterns: [] });
    const rel = files.map((f) => f.replace(`${root}/`, "")).sort();
    expect(rel).toEqual(["src/a.ts", "src/b.tsx", "src/c.mts", "src/d.cts", "src/deep/f.ts"]);
  });

  test("explicit patterns override default", async () => {
    const root = fixture();
    const files = await discoverFiles({ cwd: root, patterns: ["src/a.ts"] });
    const rel = files.map((f) => f.replace(`${root}/`, ""));
    expect(rel).toEqual(["src/a.ts"]);
  });

  test("ignores node_modules and dist by default", async () => {
    const root = fixture();
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "node_modules", "x", "y.ts"), "// y");
    writeFileSync(join(root, "dist", "z.ts"), "// z");
    const files = await discoverFiles({ cwd: root, patterns: [] });
    const all = files.map((f) => f.replace(`${root}/`, ""));
    expect(all.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(all.some((p) => p.startsWith("dist/"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test test/cli/discover.test.ts`
Expected: FAIL — `discover` not yet written.

- [ ] **Step 3: Write `src/cli/discover.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/discover.ts test/cli/discover.test.ts
git commit -m "feat(cli): file discovery via fast-glob"
```

---

### Task 24: Default rewrite mode (atomic writes)

**Files:**
- Modify: `src/cli/rewrite.ts` (replace stub)
- Create: `test/cli/rewrite.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRewrite } from "../../src/cli/rewrite";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function fixture(userSource: string): { root: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), "mintz-cli-"));
  dirs.push(root);
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
  const entry = join(root, "src", "user.ts");
  writeFileSync(entry, userSource);
  return { root, entry };
}

describe("runRewrite", () => {
  test("rewrites a state-1 file to state-2 (committed wrapper form)", async () => {
    const { root, entry } = fixture(
      ['import mint from "mintz";', "export const x = mint<\"a\" | \"b\">();", ""].join("\n"),
    );
    const code = await runRewrite({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).toBe(0);
    const after = readFileSync(entry, "utf8");
    expect(after).toContain('mint<"a" | "b">(["a", "b"])');
    expect(after).not.toContain('mint<"a" | "b">()');
  });

  test("idempotent: re-running on already-codegen'd source does nothing", async () => {
    const { root, entry } = fixture(
      [
        'import mint from "mintz";',
        'export const x = mint<"a" | "b">(["a", "b"]);',
        "",
      ].join("\n"),
    );
    const before = readFileSync(entry, "utf8");
    const code = await runRewrite({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).toBe(0);
    expect(readFileSync(entry, "utf8")).toBe(before);
  });

  test("dry-run does not write but reports", async () => {
    const { root, entry } = fixture(
      ['import mint from "mintz";', "export const x = mint<\"a\">();", ""].join("\n"),
    );
    const before = readFileSync(entry, "utf8");
    const code = await runRewrite({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: true,
    });
    expect(code).toBe(0);
    expect(readFileSync(entry, "utf8")).toBe(before);
  });

  test("non-zero exit when one file errors but writes the rest", async () => {
    const { root } = fixture("");
    writeFileSync(
      join(root, "src", "ok.ts"),
      ['import mint from "mintz";', "export const a = mint<\"a\">();", ""].join("\n"),
    );
    writeFileSync(
      join(root, "src", "bad.ts"),
      ['import mint from "mintz";', "export const b = mint<string>();", ""].join("\n"),
    );
    const code = await runRewrite({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).not.toBe(0);
    expect(readFileSync(join(root, "src", "ok.ts"), "utf8")).toContain('mint<"a">(["a"])');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test test/cli/rewrite.test.ts`
Expected: FAIL — stub `runRewrite` returns 0 but doesn't transform.

- [ ] **Step 3: Replace `src/cli/rewrite.ts`**

```ts
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
    // Windows fallback: rename can fail with EPERM over an existing file.
    try {
      await writeFile(path, contents, "utf8");
    } finally {
      await unlink(tmp).catch(() => {});
    }
    if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/rewrite.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/rewrite.ts test/cli/rewrite.test.ts
git commit -m "feat(cli): default rewrite mode with atomic writes"
```

---

### Task 25: `--check` mode (drift detection)

**Files:**
- Modify: `src/cli/check.ts` (replace stub)
- Create: `test/cli/check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../../src/cli/check";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function fixture(userSource: string): { root: string; entry: string } {
  const root = mkdtempSync(join(tmpdir(), "mintz-check-"));
  dirs.push(root);
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
  const entry = join(root, "src", "user.ts");
  writeFileSync(entry, userSource);
  return { root, entry };
}

describe("runCheck", () => {
  test("returns 0 when source is in sync with type", async () => {
    const { root, entry } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">(["a", "b"]);', ""].join("\n"),
    );
    const before = readFileSync(entry, "utf8");
    const code = await runCheck({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).toBe(0);
    expect(readFileSync(entry, "utf8")).toBe(before); // never wrote
  });

  test("returns non-zero on drift (stale array)", async () => {
    const { root } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">(["a"]);', ""].join("\n"),
    );
    const code = await runCheck({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).not.toBe(0);
  });

  test("returns non-zero on un-codegen'd source (state 1)", async () => {
    const { root } = fixture(
      ['import mint from "mintz";', 'export const x = mint<"a" | "b">();', ""].join("\n"),
    );
    const code = await runCheck({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });
    expect(code).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test test/cli/check.test.ts`
Expected: FAIL.

- [ ] **Step 3: Replace `src/cli/check.ts`**

```ts
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
      process.stderr.write(
        `mintz check: ${driftedCount} drifted, ${errorCount} error(s)\n`,
      );
    }
  }
  return driftedCount + errorCount > 0 ? 1 : 0;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/check.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/check.ts test/cli/check.test.ts
git commit -m "feat(cli): --check mode for drift detection"
```

---

### Task 26: `--watch` mode

**Files:**
- Modify: `src/cli/watch.ts` (replace stub)
- Create: `test/cli/watch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWatch } from "../../src/cli/watch";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("runWatch", () => {
  test("rewrites once on start, then again when source changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "mintz-watch-"));
    dirs.push(root);
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
    const entry = join(root, "src", "user.ts");
    writeFileSync(entry, ['import mint from "mintz";', 'export const x = mint<"a">();'].join("\n"));

    const watcher = runWatch({
      cwd: root,
      paths: [],
      tsconfig: join(root, "tsconfig.json"),
      json: false,
      silent: true,
      dryRun: false,
    });

    // Wait for initial pass.
    await new Promise((r) => setTimeout(r, 300));
    expect(readFileSync(entry, "utf8")).toContain('mint<"a">(["a"])');

    // Modify source.
    writeFileSync(entry, ['import mint from "mintz";', 'export const x = mint<"a" | "b">();'].join("\n"));
    await new Promise((r) => setTimeout(r, 600));
    expect(readFileSync(entry, "utf8")).toContain('mint<"a" | "b">(["a", "b"])');

    await watcher.stop();
  }, { timeout: 5000 });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test test/cli/watch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Replace `src/cli/watch.ts`**

```ts
import chokidar from "chokidar";
import { runRewrite } from "./rewrite";
import type { RunOptions } from "./rewrite";

export interface WatchHandle {
  stop(): Promise<void>;
}

export function runWatch(opts: RunOptions): WatchHandle & Promise<number> {
  let stopped = false;
  let inProgress: Promise<number> = Promise.resolve(0);

  // Initial pass.
  inProgress = runRewrite(opts);

  const watcher = chokidar.watch(
    opts.paths.length > 0
      ? [...opts.paths]
      : ["src/**/*.ts", "src/**/*.tsx", "src/**/*.mts", "src/**/*.cts"],
    {
      cwd: opts.cwd ?? process.cwd(),
      ignored: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
      ignoreInitial: true,
    },
  );

  watcher.on("change", () => {
    if (stopped) return;
    inProgress = inProgress.then(() => runRewrite(opts));
  });
  watcher.on("add", () => {
    if (stopped) return;
    inProgress = inProgress.then(() => runRewrite(opts));
  });

  const handle = {
    async stop() {
      stopped = true;
      await watcher.close();
      await inProgress;
    },
  };

  // Return a promise that never resolves on its own; users call stop() to end.
  // For typing purposes, attach the handle properties to a Promise.
  const promise = new Promise<number>(() => {}) as WatchHandle & Promise<number>;
  Object.assign(promise, handle);
  return promise;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/watch.ts test/cli/watch.test.ts
git commit -m "feat(cli): --watch mode via chokidar"
```

---

### Task 27: CLI smoke test (run the bin)

**Files:**
- Create: `test/cli/bin.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

describe("mintz CLI bin", () => {
  test("--help shows usage", async () => {
    const proc = Bun.spawn(["bun", CLI, "--help"], { stdout: "pipe", stderr: "pipe" });
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
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      );
      const exitCode = await proc.exited;
      expect(exitCode).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test**

Run: `bun test test/cli/bin.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/cli/bin.test.ts
git commit -m "test(cli): bin smoke test for --help and --check"
```

---

## Phase 6 — Type-level tests + example app

### Task 28: Type-level tests with `tsd`

**Files:**
- Create: `test/types.test-d.ts`

- [ ] **Step 1: Write the test**

```ts
import { expectAssignable, expectError, expectType } from "tsd";
import mint from "../src/runtime";

// Returns a readonly array narrowed to the literal union.
const events = mint<"a" | "b">(["a", "b"]);
expectType<readonly ("a" | "b")[]>(events);

// Numbers
const codes = mint<200 | 404>([200, 404]);
expectType<readonly (200 | 404)[]>(codes);

// Mixed kinds
const mixed = mint<"a" | 1 | true | null>(["a", 1, true, null]);
expectAssignable<readonly ("a" | 1 | true | null)[]>(mixed);

// Object types are rejected by `T extends Lit`.
expectError(mint<{ a: 1 }>([]));
expectError(mint<string[]>([]));
expectError(mint<Date>([]));

// `any` and `unknown` are NOT caught at type-check time (deferred to build).
expectAssignable<readonly unknown[]>(mint<any>([]));
```

- [ ] **Step 2: Run tsd**

Run: `bun run test:types`
Expected: PASS — all assertions hold.

- [ ] **Step 3: Commit**

```bash
git add test/types.test-d.ts
git commit -m "test(types): tsd assertions for the mint() generic"
```

---

### Task 29: Example app — ws-events

**Files:**
- Create: `examples/ws-events/{package.json,tsconfig.json,bunfig.toml,preload.ts,src/ws-events.ts,src/server.ts,README.md}`

- [ ] **Step 1: Create `examples/ws-events/package.json`**

```json
{
  "name": "mintz-example-ws-events",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/server.ts",
    "build": "bun build src/server.ts --outdir dist --target bun",
    "codegen": "mintz src/**/*.ts"
  },
  "dependencies": {
    "mintz": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `examples/ws-events/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "./src"
  },
  "include": ["src/**/*", "preload.ts"]
}
```

- [ ] **Step 3: Create `examples/ws-events/bunfig.toml`**

```toml
preload = ["./preload.ts"]
```

- [ ] **Step 4: Create `examples/ws-events/preload.ts`**

```ts
import { plugin } from "bun";
import mintz from "mintz/bun";
plugin(mintz());
```

- [ ] **Step 5: Create `examples/ws-events/src/ws-events.ts`**

```ts
import mint from "mintz";

export type ClientToServerEvent =
  | { kind: "lobby.join"; roomCode: string }
  | { kind: "lobby.leave" }
  | { kind: "round.submit"; turn: number; payload: string }
  | { kind: "system.ping" };

export const CLIENT_EVENT_NAMES = mint<ClientToServerEvent["kind"]>();
// → ["lobby.join", "lobby.leave", "round.submit", "system.ping"]

export function isClientEventName(s: string): s is ClientToServerEvent["kind"] {
  return (CLIENT_EVENT_NAMES as readonly string[]).includes(s);
}
```

- [ ] **Step 6: Create `examples/ws-events/src/server.ts`**

```ts
import { CLIENT_EVENT_NAMES, isClientEventName } from "./ws-events";

console.log("Accepting events:", CLIENT_EVENT_NAMES);
console.log("Is 'lobby.join' valid?", isClientEventName("lobby.join"));
console.log("Is 'evil.injection' valid?", isClientEventName("evil.injection"));
```

- [ ] **Step 7: Create `examples/ws-events/README.md`**

```markdown
# mintz example — ws-events

Demonstrates the wire-protocol use case: a discriminated union of WebSocket
events, with the discriminator strings made available at runtime via
`mint<ClientToServerEvent["kind"]>()`.

## Run with Bun (build mode)

```sh
bun run start
```

The `bunfig.toml` preload registers the mintz plugin, which inlines
`CLIENT_EVENT_NAMES` at file-load time.

## Run with codegen mode (e.g. for non-Bun toolchains)

```sh
bun run codegen   # rewrites src/ws-events.ts to embed the array
bun run src/server.ts
```
```

- [ ] **Step 8: Verify the example builds and runs**

Run from repo root:
```sh
cd examples/ws-events && bun install && bun run start
```
Expected: prints the array and two boolean checks. **Note:** until the
package is built and linked, you may need to run `bun run build` at the
repo root first so `dist/` is populated.

- [ ] **Step 9: Commit**

```bash
git add examples/ws-events/
git commit -m "docs: add ws-events example demonstrating wire-protocol use case"
```

---

## Phase 7 — Build, CI, and docs

### Task 30: Verify production build

**Files:**
- (no new files)

- [ ] **Step 1: Run the full build**

Run: `bun run build`
Expected: `dist/` contains `runtime.js`, `runtime.d.ts`, `bun/index.js`, `bun/index.d.ts`, `cli/index.js`, `cli/index.d.ts`, plus source maps.

- [ ] **Step 2: Verify the runtime entry has no ts-morph or chokidar imports**

Run: `cat dist/runtime.js | grep -E '(ts-morph|chokidar|fast-glob|citty)' || echo 'CLEAN'`
Expected: `CLEAN`. The runtime stub should not pull in build-time dependencies.

- [ ] **Step 3: Confirm the bin shebang is preserved**

Run: `head -1 dist/cli/index.js`
Expected: `#!/usr/bin/env node`

- [ ] **Step 4: Smoke-test the built CLI**

Run: `node dist/cli/index.js --help`
Expected: prints CLI help.

- [ ] **Step 5: Commit if any build config changed**

```bash
# Likely no changes to commit unless you tweaked tsup.config.ts.
git status
```

---

### Task 31: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: ${{ matrix.os }} · Bun · TS ${{ matrix.typescript }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        typescript: ["5.4", "5.6", "5.8", "latest"]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun add -D typescript@${{ matrix.typescript }}
      - run: bun run lint
      - run: bun run typecheck
      - run: bun test --coverage
      - run: bun run test:types
      - run: bun run build

  coverage-gate:
    name: Coverage gate (Ubuntu · TS latest)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      # The coverageThreshold in bunfig.toml enforces the bar; this job
      # just runs it once on a single cell to fail fast for coverage drops.
      - run: bun test --coverage
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test matrix (OS × TypeScript version)"
```

---

### Task 32: README + LICENSE + CONTRIBUTING

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# mintz

> Read your TypeScript types at runtime. Bun-native. Zero magic at the call site.

```ts
import mint from "mintz";

const colors = mint<"red" | "green" | "blue">();
// → ["blue", "green", "red"]
```

`mintz` resolves a TypeScript literal-union type into a runtime array, at
build time (via a Bun plugin) or via a CLI codegen step (works in any
toolchain). The same primitive `mint<T>()` is used in every mode.

## Why?

TypeScript's literal-union types don't exist at runtime. Anyone needing the
runtime list duplicates it manually — a maintenance burden that drifts every
time the union changes. Existing solutions either embed this capability inside
much larger frameworks (typia, deepkit) or require a TypeScript compiler-
transformer toolchain (ts-patch / ttypescript) that Bun does not natively
support.

`mintz` is the focused library that does only this, with first-class Bun
integration and a CLI fallback that works under any toolchain.

## The realistic example — wire protocols

```ts
import mint from "mintz";

type ClientToServerEvent =
  | { kind: "lobby.join"; roomCode: string }
  | { kind: "lobby.leave" }
  | { kind: "round.submit"; turn: number; payload: string }
  | { kind: "system.ping" };

export const CLIENT_EVENT_NAMES = mint<ClientToServerEvent["kind"]>();
// → ["lobby.join", "lobby.leave", "round.submit", "system.ping"]
```

## Bun setup (recommended)

### Preload mode — for `bun run` and `bun test`

```ts
// preload.ts
import { plugin } from "bun";
import mintz from "mintz/bun";
plugin(mintz());
```

```toml
# bunfig.toml
preload = ["./preload.ts"]

[test]
preload = ["./preload.ts"]
```

### Bundle mode — for `Bun.build`

```ts
import mintz from "mintz/bun";
await Bun.build({
  entrypoints: ["./src/app.ts"],
  outdir: "./dist",
  plugins: [mintz()],
});
```

## Node setup (CLI codegen)

```sh
npm i -D mintz typescript
npx mintz                # rewrites src/**/*.ts in place
npx mintz --check        # CI gate: exit non-zero on drift
```

Add to `package.json`:

```json
{
  "scripts": {
    "build": "mintz && tsc",
    "ci:mintz": "mintz --check"
  }
}
```

## Limitations

- **No resolution of generic parameters at the call site.** `mint<T>()`
  inside a generic function body, where `T` is a type parameter, is rejected.
- **TypeScript-version skew.** mintz is tested against TypeScript 5.4 through
  the latest minor.
- **Drift in codegen mode** is real — see [drift detection](#drift-detection-in-ci).
- **Stack-trace call-site extraction** uses `Error.captureStackTrace`, which
  is V8-only (Node, Bun, Chrome). On Safari or Firefox the runtime error
  message still works, but omits the call-site line.

## Comparison

| | Manual `as const` | mintz | typia | deepkit | ts-transformer-enumerate |
|---|---|---|---|---|---|
| Single primitive | n/a | ✅ `mint<T>()` | ❌ wide API | ❌ framework | ⚠ enumerate-only |
| Stays in sync with the type | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Drift detection in CI** | ❌ | ✅ | n/a | n/a | n/a |
| Bun-first | n/a | ✅ | ⚠ unplugin | ⚠ @deepkit/bun | ❌ |
| Codegen mode (no build hook) | n/a | ✅ | ❌ | ❌ | ❌ |
| Works under vanilla `tsc` | ✅ | ✅ (after CLI run) | ❌ | ❌ | ❌ |
| Validation included | ❌ | ❌ | ✅ | ✅ | ❌ |

## Drift detection in CI

In codegen mode, the runtime array is committed to git. If you add a member
to the union and forget to re-run `mintz`, TypeScript won't catch the
mismatch (a narrower array is still assignable to a wider type). Run
`mintz --check` in CI to catch this:

```yaml
# .github/workflows/ci.yml
- run: npx mintz --check
```

In Bun build/preload mode, the plugin re-resolves on every load; drift is
structurally impossible.

## License

MIT
```

- [ ] **Step 2: Write `LICENSE`** (standard MIT; year + copyright holder)

Insert standard MIT text with `Copyright (c) 2026 <user>`.

- [ ] **Step 3: Write `CONTRIBUTING.md`**

```markdown
# Contributing to mintz

Thanks for considering a contribution. mintz is a small, focused library.
Before opening a large PR, please open an issue to discuss the approach.

## Development

```sh
git clone https://github.com/<user>/mintz
cd mintz
bun install
bun test          # all tests
bun run lint      # biome
bun run typecheck # tsc --noEmit
bun run build     # tsup
```

## Adding a new edge case

mintz uses fixture-driven tests. To add a case:

1. Create `test/fixtures/<NN-kebab-name>/`
2. Inside, create `input.ts`, `expected.ts`, and `tsconfig.json` (see
   existing fixtures for the template).
3. Run `bun test test/engine/fixtures.test.ts` — your fixture will be
   discovered automatically.

For an error case, put it under `test/fixtures/error/` and create
`expected-code.txt` containing the expected diagnostic code.

## Scope discipline

The non-goals listed in the design doc
(`docs/superpowers/specs/2026-04-30-mintz-design.md` §2) are hard cuts.
If you're tempted to add a `mintEntries` / `mintObject` / `pluck` helper,
file an issue first; the answer is usually "compose with TypeScript's
existing operators."
```

- [ ] **Step 4: Write `CODE_OF_CONDUCT.md`**

Use the Contributor Covenant 2.1 standard text (copy from
https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

- [ ] **Step 5: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Initial implementation of `mint<T>()` runtime, Bun plugin, and CLI codegen.
- Drift detection via `mintz --check`.
- Cross-runtime: works on Bun and on Node + tsc / ts-node / tsx.
```

- [ ] **Step 6: Commit**

```bash
git add README.md LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md CHANGELOG.md
git commit -m "docs: add README, LICENSE, CONTRIBUTING, CoC, CHANGELOG"
```

---

### Task 33: Final verification

**Files:**
- (no new files)

- [ ] **Step 1: Run every test layer**

Run:
```sh
bun run lint
bun run typecheck
bun test
bun run test:types
bun run build
```
Expected: all green.

- [ ] **Step 2: Verify the example app still runs end-to-end**

Run:
```sh
cd examples/ws-events
bun install
bun run start
```
Expected: prints the resolved event names array.

- [ ] **Step 3: Final commit**

```bash
git status
# If anything uncommitted from the verification:
git add -A
git commit -m "chore: final v0.0.0 verification"
```

- [ ] **Step 4: Tag for the first 0.x release (optional, only when ready)**

```bash
git tag v0.1.0
# (do not push the tag yet; that's the publish step)
```

---

## Self-review checklist

After completing all 33 tasks, run this checklist before declaring v0.1.0 ready:

**Spec coverage (§-by-§):**
- [ ] §3 Architecture — engine + Bun plugin + CLI all implemented (Tasks 6–26)
- [ ] §4 Public API — runtime stub, Lit type with undefined, three call states (Tasks 4–5, 12)
- [ ] §4.4 Error format — `MintzNotTransformedError` + V8-only call site (Task 5)
- [ ] §4.5 Strict-constraint snippet — documented in spec, simpler constraint shipped (Task 4)
- [ ] §4.6 Discriminated-union non-example — error fixture covers it (Task 19, fixture 06)
- [ ] §4.7 Determinism — sortLiterals UTF-16 + numeric + grouped (Task 10)
- [ ] §4.8 Drift in codegen mode — `--check` mode catches it (Task 25)
- [ ] §5 Bun plugin — onLoad with fast-skip, throws on errors (Task 20)
- [ ] §6 CLI — rewrite, --check, --watch, --json, --silent, atomic writes, partial-failure semantics (Tasks 22–27)
- [ ] §7 Edge cases — every row in the table has a fixture (Tasks 13–19)
- [ ] §8 Errors — three modes, three channels (Tasks 5, 20, 24, 25)
- [ ] §9 Testing strategy — engine fixtures + Bun integration + CLI integration + types (Tasks 13–28)
- [ ] §10 Performance — fast-skip + project cache (Tasks 7, 20)
- [ ] §11 OSS plan — README, LICENSE, CONTRIBUTING, CoC, CHANGELOG, comparison table, CI matrix (Tasks 31–32)

**Hard cuts honored (§2 non-goals):**
- [ ] No unplugin wrapper
- [ ] No ts-patch transformer
- [ ] No JSR config
- [ ] No mintEntries / pluck / keys / values / mintObject helpers
- [ ] No persistent on-disk cache
- [ ] No Bun-macro API
- [ ] No tsconfig mutation

**No placeholders:** Search the plan and any committed file for `TBD`, `TODO`,
`XXX`, `FIXME`. The spec's §12 "Open questions" deliberately uses `TBD` —
those are the only acceptable instances.

**Type consistency check:**
- [ ] `Lit` type identical in `src/runtime.ts`, `src/engine/types.ts`, and tsd tests
- [ ] `Diagnostic` interface identical in `src/errors.ts` and consumers
- [ ] `TransformOptions` / `TransformResult` shapes match between engine and callers (Bun plugin, CLI)
- [ ] `RunOptions` shape consistent across `src/cli/rewrite.ts`, `check.ts`, `watch.ts`

If any item is unchecked, fix it before tagging v0.1.0.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-30-mintz-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for solo execution where each task is independent and testable.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best if you want to be in the loop more directly.

**Which approach?**
