# mintz — Design Document

**Date:** 2026-04-30
**Status:** Draft for review
**License (planned):** MIT
**Distribution (planned):** npm (v1), JSR (v2)

---

## 1. Overview

`mintz` reads your TypeScript types and gives you the values at runtime, without
the types having to exist at runtime.

The library exposes a single primitive:

```ts
import mint from "mintz";

const events = mint<ClientToServerEvent["event"]>();
// → ['lobby.reaction', 'player.typing', 'round.sequential.submit_answer',
//    'round.submit_answers', 'system.ping']
```

The TypeScript type system already produces the union you want
(`ClientToServerEvent["event"]` is the `'event'`-field of every variant in the
union, computed by the type checker). The unsolved problem is the last hop —
turning that union into a runtime array. `mintz` solves only that hop.

### Why this exists

TypeScript types are erased at runtime. There is no native operator to
enumerate a literal union as a `string[]`. Existing solutions either embed
this capability inside a much larger framework (e.g. typia's
`typia.misc.literals<T>()` is one corner of a full validation suite, deepkit's
reflection comes with an entire backend framework), require a TypeScript
compiler-transformer toolchain that Bun does not natively support
(ts-transformer-enumerate via ts-patch / ttypescript), or expect the user to
hand-roll a one-off ts-morph script.

`mintz` is the focused library that does only this, with first-class Bun
integration and a CLI that works under any toolchain.

### Audience and use cases

- **Wire-protocol authors.** Event names, message types, RPC method names
  defined as a discriminated union of object types. Need the discriminator
  strings as a runtime array for routing, validation, exhaustiveness checks,
  log filtering, and type-driven schema generation.
- **Permissions / role / status-code lists.** Types defined as literal unions
  used at runtime for whitelisting and validation.
- **Enum-like const objects.** Combined with `keyof typeof X` and
  `T[keyof T]`, `mintz` provides the runtime equivalent of TypeScript enums
  without committing to the `enum` keyword.

---

## 2. Goals and non-goals

### Goals (v1)

1. Single function `mint<T>()` where `T` resolves to a finite union of literal
   types (`string`, `number`, `boolean`, `bigint`, `null`).
2. Bun-first: same plugin object works in `Bun.build` and in `bunfig.toml`
   `preload`.
3. Cross-runtime via CLI codegen: `npx mintz` rewrites source files in place
   so any toolchain (`tsc`, `ts-node`, `tsx`, Webpack, Vite, etc.) sees the
   resolved arrays.
4. Zero runtime cost in build mode: `mint<T>()` collapses to a bare
   `[…] as const`. In codegen mode it collapses to a one-line identity
   function that returns its argument.
5. Loud failure when the build-time transform did not run: the runtime stub
   throws `MintzNotTransformedError` with a multi-line, actionable message.
6. Deterministic output: stable ordering rules so that re-running the codegen
   produces byte-identical output and git diffs reflect only real type
   changes.
7. MIT licensed, single npm package.
8. Tested against a TypeScript-version matrix.

### Non-goals (v1)

- Vite/Webpack/Rollup `unplugin` wrapper — deferred to v2.
- TypeScript transformer plugin via `ts-patch`/`ttypescript` — v2.
- JSR (Deno-friendly registry) publishing — v2.
- Convenience helpers `mintEntries<T>()`, `mintObject<T>()`, `pluck<T,K>()`,
  `keys<T>()`, `values<T>()` — locked out for v1. The single-primitive
  philosophy is part of the value proposition; users compose with TypeScript's
  existing operators.
- Bun-macro-based API (`with { type: "macro" }`) — incompatible with Bun's
  current macro architecture, which receives JS values after TypeScript type
  erasure. Reconsider only if Bun's macro design ever evolves.
- Browser/Deno engine — the engine runs on Node and Bun only. The runtime
  stub is plain ESM and works anywhere.
- Persistent on-disk cache — the engine maintains an in-memory result cache
  (§10.2) but does not write a cache file to disk. Defer to v2 if cold-start
  perf becomes a problem.
- Sourcemap preservation as a guaranteed feature — v1 is best-effort. The
  build mode aims to preserve call-site positions in emitted sourcemaps but
  does not promise byte-identical mappings; users debugging into the
  inlined array literal may land slightly off the original `mint<T>()` line.
- Mutation of the user's tsconfig.json — the engine reads tsconfig settings
  (paths, baseUrl, lib, target, etc.) but never writes to it. Users wanting
  path aliases must configure them in tsconfig themselves.
- Cross-file partial-failure transactionality — the CLI processes files
  best-effort: when one file fails to resolve, the CLI emits its diagnostic
  and continues processing the rest, then exits non-zero with a summary.
  No "all or nothing" rewrite mode in v1.

---

## 3. Architecture

### 3.1 High-level

```
                        ┌──────────────────────────┐
                        │     TRANSFORM ENGINE     │
                        │  (cross-runtime, ts-     │
                        │   morph based)           │
                        └────────────┬─────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
       BUN PLUGIN                  CLI                    RUNTIME STUB
       (mintz/bun)                 (mintz bin)            (mintz)
       BunPlugin factory           file-rewriter          10-line
       Used by:                    Idempotent             function
         • Bun.build               --check / --watch
         • bunfig preload          --json output
       Filter: /\.tsx?$/
       Fast-skip on
       indexOf("mintz")
```

Each shell calls the same `transform({ source, filename, project }) → { code,
modified, diagnostics }` engine function. Mode-specific code is thin (a few
hundred lines per shell at most).

### 3.2 Components

| Component | Path | Role | Approx LOC |
|---|---|---|---|
| Engine | `src/engine/index.ts` | Pure transform: text in, text out + diagnostics. | ~200 |
| AST helpers | `src/engine/ast.ts` | ts-morph wrappers: find call sites, resolve `T`, emit literal nodes. | ~250 |
| Type-classifier | `src/engine/classify.ts` | Decide whether resolved `T` is a finite literal union; sort emission. | ~120 |
| Runtime stub | `src/runtime.ts` | The published `mint` function. | ~30 |
| Bun plugin | `src/bun/index.ts` | `BunPlugin` factory used in build and preload modes. | ~80 |
| CLI | `src/cli/index.ts` | `mintz` binary; flags, file walking, write-back. | ~200 |
| Errors | `src/errors.ts` | `MintzNotTransformedError`, build-time error formatter. | ~80 |

### 3.3 Built on ts-morph

[ts-morph](https://ts-morph.com/) wraps the TypeScript compiler API with a
significantly more ergonomic surface. Methods used:

- `Project` — owns tsconfig context and a `TypeChecker`. One per tsconfig,
  cached for the process lifetime.
- `getDescendantsOfKind(SyntaxKind.CallExpression)` — find candidate calls.
- `getSymbol()` and symbol-identity comparison — match calls to `mintz`'s
  default export, not to the textual name `mint` (handles aliasing,
  re-exports, shadowing).
- `Type.getUnionTypes()`, `Type.isStringLiteral()`, `Type.getLiteralValue()`,
  `Type.isNumberLiteral()`, etc. — resolve `T`.
- `Node.replaceWithText()` — emit replacements.

ts-morph adds ~5 MB to install size — acceptable because it is a build-time
dependency only. Production code never imports it.

### 3.4 npm package shape

```json
{
  "name": "mintz",
  "type": "module",
  "exports": {
    ".":     { "types": "./dist/runtime.d.ts", "default": "./dist/runtime.js" },
    "./bun": { "types": "./dist/bun/index.d.ts", "default": "./dist/bun/index.js" }
  },
  "bin": { "mintz": "./dist/cli/index.js" },
  "peerDependencies": { "typescript": ">=5.4" },
  "dependencies":     { "ts-morph": "^28.0.0" }
}
```

Production bundlers walking imports from `"mintz"` reach only `dist/runtime.js`.
ts-morph and the Bun plugin/CLI code are unreachable from that entry, so the
production install footprint is tiny.

---

## 4. Public API

### 4.1 The signature

```ts
// src/runtime.ts
export type Lit = string | number | boolean | bigint | null | undefined;

export default function mint<T extends Lit>(
  values?: readonly T[],
): readonly T[];
```

Implementation:

```ts
function mint<T extends Lit>(values?: readonly T[]): readonly T[] {
  if (arguments.length > 0) return values as readonly T[];
  throw new MintzNotTransformedError();
}
```

That is the entire runtime. The constraint `T extends Lit` keeps the most
common authoring mistakes inside TypeScript's normal diagnostic flow; the
optional `values` argument makes the codegen'd form valid runtime code.

`undefined` is included in `Lit` because `'a' | undefined` is a normal TS
shape (e.g. an optional discriminator). The engine emits `undefined` as the
JavaScript identifier `undefined`. Callers who don't want it in the array
should narrow `T` with `Exclude<T, undefined>` or `NonNullable<T>`.

**`arguments.length > 0` instead of `values !== undefined`.** The runtime
needs to distinguish "not invoked with the values argument" (untransformed)
from "invoked with values that happen to include `undefined`". Checking
`arguments.length` is the only way to tell those apart at runtime.

**Default vs named export.** `mint` is exported as the default export so
that consumers can rename it freely on import (`import m from "mintz"`,
`import literals from "mintz"`, etc.). The named export `mint` is also
provided for ergonomics and so consumers using `verbatimModuleSyntax` aren't
forced through the default-import path. Both refer to the same function.

```ts
// Both supported
import mint from "mintz";
import { mint } from "mintz";
```

### 4.2 Three forms in the call lifecycle

Every `mint<T>()` call passes through up to three states. Each state is valid
TypeScript that type-checks and runs; `mintz` works whether or not the user
has wired up the plugin or run the CLI, with progressively cleaner output.

```ts
// STATE 1 — AUTHORED (you write this)
const events = mint<ClientToServerEvent["event"]>();

// STATE 2 — CODEGEN'D (after `npx mintz`)
const events = mint<ClientToServerEvent["event"]>([
  "lobby.reaction",
  "player.typing",
  "round.sequential.submit_answer",
  "round.submit_answers",
  "system.ping",
]);

// STATE 3 — INLINED (after Bun plugin runs at build/preload time)
const events = [
  "lobby.reaction",
  "player.typing",
  "round.sequential.submit_answer",
  "round.submit_answers",
  "system.ping",
] as const;
```

Transitions:

- 1 → 2: user runs the CLI (`npx mintz`). Idempotent; rerunning on a type
  change updates the array.
- 1 → 3 or 2 → 3: Bun plugin runs at build/preload time. Plugin accepts both
  forms as input.
- 2 → 1: user manually deletes the `values` argument (rare). CLI's `--check`
  mode catches this in CI.

### 4.3 Runtime behavior

| Call form | Runtime behavior |
|---|---|
| `mint<T>(values)` (state 2) | Returns `values` unchanged. ~1 ns, zero allocation. |
| `mint<T>()` (state 1, transform skipped) | Throws `MintzNotTransformedError`. |
| (state 3) | Function is never invoked at runtime; the call site is the array literal. |

### 4.4 `MintzNotTransformedError`

Best-effort call-site extraction via `Error.captureStackTrace` when available
(V8: Node, Bun, Chrome, Edge). On engines without it (JavaScriptCore in
Safari, SpiderMonkey in Firefox), the call-site line is omitted; the rest of
the message is unchanged and remains useful. The runtime never throws from
the stack-trace probe itself.

```
MintzNotTransformedError:
  mint<T>() was called without runtime values. This means the
  build-time transform did not run on this file.

  To fix, choose one:
    • Bun runtime/test:
        Add a preload that registers the plugin:
          // preload.ts
          import { plugin } from "bun";
          import mintz from "mintz/bun";
          plugin(mintz());
        Then in bunfig.toml:
          preload = ["./preload.ts"]
    • Bun bundler:
        Add the plugin to Bun.build:
          import mintz from "mintz/bun";
          await Bun.build({ plugins: [mintz()], … });
    • Node + tsc / ts-node / tsx:
        Run `npx mintz` once to populate values.
        Add to package.json:  "build": "mintz && tsc"
    • CI:
        Add `mintz --check` to fail PRs where source has drifted
        from types.

  See https://github.com/<user>/mintz#setup
  Call site: src/events.ts:14:18    (omitted on engines without
                                     Error.captureStackTrace)
```

### 4.5 Generic constraint: what TypeScript catches and what the build catches

The constraint `T extends Lit` is intentionally permissive. Because `string`,
`number`, `boolean`, and `bigint` themselves all satisfy `T extends Lit`, the
constraint does **not** reject open primitive types at the call site —
those cases are deferred to the build-time transformer, which is the
authoritative validator. Reasons for this split:

- A stricter literal-only constraint creates compounding generic complexity
  in error messages that confuses users more than it helps.
- The build transformer can produce precise file:line:col diagnostics with
  suggested fixes — much better than TypeScript's generic-mismatch messages
  for the same problem.

What TypeScript catches at type-check time (red squiggle in editor):

```ts
mint<{ a: 1 }>();    // ❌ object type doesn't satisfy `Lit`
mint<string[]>();    // ❌ array type doesn't satisfy `Lit`
mint<Date>();        // ❌ class type doesn't satisfy `Lit`
```

What the build / CLI catches (with helpful diagnostics, not at type-check):

```ts
mint<string>();         // ⚠ accepted by TS; build error: "T is the open type 'string'"
mint<'a' | string>();   // ⚠ same — `string` widens the union
mint<number>();         // ⚠ same for any open primitive
mint<any>();            // ⚠ same — open type
mint<unknown>();        // ⚠ same — open type
mint<never>();          // ⚠ empty union — "did you mean `[] as const`?"
```

#### Why not a stricter type-level constraint?

A literal-only constraint can be expressed at the type level:

```ts
type IsLit<T> =
  T extends string  ? string  extends T ? false : true
: T extends number  ? number  extends T ? false : true
: T extends boolean ? boolean extends T ? false : true
: T extends bigint  ? bigint  extends T ? false : true
: T extends null | undefined ? true : false;

type AllLit<T> = T extends infer U ? IsLit<U> : never;

function mint<T extends Lit>(
  values?: AllLit<T> extends true ? readonly T[] : never,
): AllLit<T> extends true ? readonly T[] : never;
```

This compiles, and `mint<string>()` does end up returning `never`. But the
TypeScript error message a user sees on the wrong call is something like
`Argument of type 'undefined' is not assignable to parameter of type 'never'`,
which is opaque and unhelpful. The build's structured diagnostic
("T contains the open type `string`; narrow it with…") is materially better
UX than fighting through generic-mismatch chains.

The simpler `T extends Lit` constraint catches obvious shape errors at the
call site (objects, arrays, classes) and lets the build handle subtler open-
type cases with a clear message. This split matches typia's design choice
for the same reason.

### 4.6 What `T` can be

`T extends Lit` constrains the *terminal* form. TypeScript's existing
operators do all the routing:

```ts
// Direct literal union
mint<'a' | 'b' | 'c'>();

// Indexed access on a discriminated union (the wire-protocol pattern)
mint<ClientToServerEvent['event']>();

// keyof an interface or const object
mint<keyof Config>();
mint<keyof typeof MY_CONST>();

// Values of an enum-like const object
mint<typeof Status[keyof typeof Status]>();

// Filtering
mint<Exclude<Color, 'deprecated'>>();

// Template literal types (must resolve to a finite domain)
mint<`evt.${'a' | 'b'}`>();   // → ['evt.a', 'evt.b']

// Native enum (numeric)
enum Direction { North, South, East, West }
mint<Direction>();             // → [0, 1, 2, 3]
mint<keyof typeof Direction>();// → ['East', 'North', 'South', 'West']

// Native enum (string)
enum Color { Red = 'red', Blue = 'blue', Green = 'green' }
mint<Color>();                 // → ['blue', 'green', 'red']
mint<keyof typeof Color>();    // → ['Blue', 'Green', 'Red']
```

#### The most common mistake: passing the union of objects directly

The pedagogically important case for wire-protocol authors is the difference
between passing the discriminated union itself versus passing the
indexed-access form of its discriminator:

```ts
type ClientToServerEvent =
  | { kind: 'lobby.reaction'; payload: ReactionPayload }
  | { kind: 'system.ping' };

// ❌ Wrong — passes the *object union*, not a literal union.
mint<ClientToServerEvent>();
// Build error:
//   T resolved to: { kind: 'lobby.reaction'; payload: ... }
//                | { kind: 'system.ping' }
//   T contains object types, which cannot be enumerated.
//   To enumerate the discriminator, use indexed access:
//     mint<ClientToServerEvent['kind']>()

// ✅ Right — indexed access pulls the discriminator union out.
mint<ClientToServerEvent['kind']>();
// → ['lobby.reaction', 'system.ping']
```

This is the most pedagogically valuable example because users coming from
runtime-data libraries (Zod, Yup, io-ts) often expect to "describe the whole
shape" — but `mint<T>` works only on the *literal-union* part of any shape,
and indexed-access is how you extract that part.

### 4.7 Determinism and emission ordering

When the engine emits an array, it sorts members deterministically so that
repeated runs produce byte-identical output:

- **Strings:** UTF-16 code-unit order, ascending. This matches JavaScript's
  default `<` operator and `Array.prototype.sort()` with no comparator. ASCII
  strings sort intuitively; non-ASCII strings sort by their UTF-16 code-unit
  values (e.g., `'café'` vs `'cafe'`). We deliberately do **not** use
  `localeCompare`, because locale-dependent collation breaks determinism.
- **Numbers and bigints:** numeric ascending. Negative numbers come first
  (`-1, 0, 1`).
- **Booleans:** `false` before `true`.
- **null:** sorted last within its kind group.
- **undefined:** sorted last within its kind group; appears after `null` if
  both are present.
- **Mixed kinds:** group by kind in the order
  `string, number, bigint, boolean, null, undefined`; sort within each group.

Therefore `mint<'b' | 'a' | 1 | true>()` emits
`['a', 'b', 1, true] as const` on every run, every machine, regardless of the
order TypeScript happens to use internally. CI's `--check` mode can compare
bytes without false positives.

### 4.8 Drift in codegen mode

This is the central hazard of codegen mode and deserves prominent treatment
in the README and CI guidance.

**The problem.** In codegen mode, `mint<T>(values)` carries a runtime array
that was correct *at the time `npx mintz` last ran*. If the user adds a
member to `T` and forgets to re-run `mintz`, the runtime array silently
drifts behind the type. TypeScript does **not** catch this:

```ts
// User wrote, codegen ran:
type Status = 'active' | 'pending';
const statuses = mint<Status>(['active', 'pending']);

// User adds 'archived' to the union but forgets to re-run codegen:
type Status = 'active' | 'pending' | 'archived';
const statuses = mint<Status>(['active', 'pending']);
// ^ TS is silent: ['active','pending'] is still a valid `Status[]`.
// ^ Runtime: missing 'archived' from the array. Bug ships.
```

The asymmetry is structural: the type signature
`mint<T>(values?: readonly T[])` is contravariant in `T` for the values
argument's element type. A *narrower* values array (fewer elements) is
always assignable to a *wider* `T`. So adding members to `T` widens it, and
the existing values array remains type-valid.

**The fix.** Codegen mode users should run `mintz --check` in CI. The
`--check` mode re-resolves `T` for every call site and compares against the
embedded values array; any drift exits non-zero with a diff:

```
$ mintz --check
ERROR mintz: array out of sync with type at src/events.ts:42:14

  const statuses = mint<Status>(['active', 'pending']);

  Type Status currently resolves to: 'active' | 'pending' | 'archived'
  Embedded values are missing:        'archived'

  Re-run `mintz` to update.
```

In build/preload mode (Bun plugin), drift is **structurally impossible**:
the plugin re-resolves `T` on every load and inlines the fresh array,
ignoring whatever the user's source happens to contain in the `values`
position. Users on Bun therefore get drift-resistance for free; users on
codegen-only toolchains must wire `mintz --check` into CI.

**The README must surface this.** Drift detection is one of mintz's
distinctive strengths over manual `as const` arrays *and* over transformer-
only tools (which inline at every build and so have no analogous risk to
detect against). See §11.7 for how this lands in the comparison table.

---

## 5. Bun plugin

### 5.1 Plugin source

```ts
// src/bun/index.ts
import type { BunPlugin } from "bun";
import { transform } from "../engine";
import { getOrCreateProject } from "../engine/project-cache";

export interface MintzPluginOptions {
  /** Path to tsconfig.json. Default: walk up from cwd. */
  tsconfig?: string;
  /** Override default file filter. */
  include?: RegExp;
  /** Skip files that don't import "mintz" without warnings. Default: true. */
  silentSkip?: boolean;
}

export default function mintzPlugin(opts: MintzPluginOptions = {}): BunPlugin {
  return {
    name: "mintz",
    setup(build) {
      // Default filter covers .ts, .tsx, .mts, .cts, and .mtsx/.ctsx.
      const filter = opts.include ?? /\.[mc]?tsx?$/;
      build.onLoad({ filter, namespace: "file" }, async ({ path }) => {
        const source = await Bun.file(path).text();
        // Fast-skip: avoid ts-morph for files that don't use mintz.
        if (!source.includes("mintz")) return;
        const project = getOrCreateProject(opts.tsconfig, path);
        const result = transform({ source, filename: path, project });
        if (result.diagnostics.some(d => d.severity === "error")) {
          // Bun's plugin API has no documented diagnostic-push surface for
          // onLoad. Fail the build by throwing; the formatted message lands
          // in the user's build output (and result.logs after `Bun.build`).
          throw new Error(formatDiagnostics(result.diagnostics, path));
        }
        for (const d of result.diagnostics) {
          if (d.severity === "warning") {
            console.warn(formatOneDiagnostic(d, path));
          }
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

// Loader selection — Bun supports "ts" and "tsx" as plugin loader values.
// Files ending .mts / .cts go through "ts"; .mtsx / .ctsx through "tsx".
function pickLoader(path: string): "ts" | "tsx" {
  return /tsx$/i.test(path) ? "tsx" : "ts";
}
```

#### Plugin behavior on already-codegen'd input (state 2)

When the plugin encounters `mint<T>([…])` (state 2), it ignores the embedded
array and re-resolves `T` from the type checker, then inlines the fresh
array. Reasons:

- It eliminates drift between the embedded array and the current type. Build
  mode is then drift-free without needing a separate check step.
- The cost is the same: ts-morph already had to run on this file because the
  fast-skip didn't match.
- Codegen mode users running `mintz --check` in CI is still the source of
  truth for committed-source drift detection (§4.8) — the plugin's
  re-resolution helps build correctness but does not replace the CI gate.

### 5.2 Wiring (build mode)

```ts
// build.ts
import mintz from "mintz/bun";
await Bun.build({
  entrypoints: ["./src/app.ts"],
  outdir: "./dist",
  plugins: [mintz()],
});
```

### 5.3 Wiring (preload mode for `bun run` and `bun test`)

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

### 5.4 Fast-skip filter

The plugin reads each `.ts/.tsx` file and runs an `indexOf("mintz")` check
before invoking ts-morph. Files that don't import mintz return immediately —
sub-microsecond cost. Only files that actually reference the package pay the
AST-resolution cost (≈ 5–20 ms per file on warm `Project`).

This is the difference between mintz adding seconds to `bun run` cold-start
versus being effectively invisible to users not using it. The same trick is
standard practice in Vite/esbuild plugins.

### 5.5 Project caching

ts-morph's `Project` is heavy to construct (loads tsconfig, scans referenced
files). The plugin maintains a module-level `Map<tsconfigPath, Project>`
populated on first use and kept for the lifetime of the Bun process. All
subsequent file loads share the same Project instance.

---

## 6. Codegen CLI

### 6.1 Usage

```
Usage: mintz [options] [globs...]

  Rewrites mint<T>() calls in TypeScript source to mint<T>([...values])
  by resolving T via the TypeScript type checker.

Default paths: ['src/**/*.{ts,tsx}']

Modes:
  (default)       Write changes to disk
  --check         Read-only; exit non-zero if any file would change (CI)
  --dry-run       Print the diff, don't write
  --watch         Re-run on file changes; ideal for ts-node/tsx dev workflow

Options:
  --tsconfig <path>   tsconfig.json path (default: walk up from cwd)
  --json              Emit diagnostics as JSON (one record per line)
  --silent            Suppress informational stdout
  --help              Show this help
  --version           Show version

Examples:
  mintz                              # rewrite all matching files
  mintz src/**/*.ts                  # narrow scope
  mintz --check                      # CI gate
  mintz --watch &                    # background, alongside `tsx watch`
```

### 6.2 Implementation notes

- Built with [`citty`](https://github.com/unjs/citty) (lightweight, ESM,
  Bun-friendly).
- Shebang `#!/usr/bin/env node` so it works under both Node and Bun.
- Writes are atomic: write to temp file in same directory then rename. On
  Windows, `fs.rename` over an existing file may throw `EPERM`; the
  implementation falls back to read-write-with-fsync if rename fails. Tested
  in the Windows CI cell (§9.5).
- `--watch` uses `chokidar` or Node's native `fs.watch` (decision deferred to
  implementation; both work).
- `--json` outputs newline-delimited JSON `{ file, line, col, severity, code,
  message }` for editor integration.

#### Per-file failure behavior

If a file fails to resolve (e.g. a `mint<T>()` call has unresolvable `T`),
the CLI:

1. Emits the diagnostic to stderr (or stdout `--json`).
2. Skips writing that file but **continues processing the remaining files**.
3. Exits non-zero at the end with a summary count of failures.

This is best-effort partial-rewrite. Users who want all-or-nothing semantics
should run `mintz --check` first, treat any non-zero exit as failure, then
run `mintz` only when check passes.

### 6.3 Idempotency

Re-running `mintz` on already-codegen'd source recomputes `T` and emits the
same array (modulo deterministic sort), so:

- Re-running with no type changes: zero file mutations.
- Re-running after a type member added/removed: only the affected file
  changes, with a focused diff showing exactly what entered or left the array.

The `mint<T>(values)` shape is the key: it preserves the type expression
inside the call so codegen can reread it on every run. Without that, the
codegen would lose the type information after the first run.

---

## 7. Edge cases

| Source pattern | Behavior |
|---|---|
| `mint<'a' \| 'b'>()` | ✅ Emit `['a', 'b']` |
| `mint<U['event']>()` | ✅ TS resolves to literal union → emit |
| `mint<keyof typeof Config>()` | ✅ TS resolves to string union → emit |
| `mint<Exclude<X, 'deprecated'>>()` | ✅ Conditional resolves → emit |
| `mint<\`evt.${'a' \| 'b'}\`>()` | ✅ Template-literal expansion → finite → emit |
| `enum Direction { N, S, E, W }; mint<Direction>()` | ✅ Numeric union → `[0, 1, 2, 3]` |
| `mint<keyof typeof Direction>()` | ✅ String union of names → `['E','N','S','W']` |
| `enum Color { Red='red', Blue='blue' }; mint<Color>()` | ✅ String enum → `['blue', 'red']` |
| `mint<keyof typeof Color>()` (string enum) | ✅ Names → `['Blue', 'Red']` |
| `const enum X { A = 1 }; mint<X>()` | ⚠ Reject under `isolatedModules: true`; error names the constraint. Allow under `isolatedModules: false` (rare). |
| `mint<typeof MY_CONST_ARRAY[number]>()` | ✅ Element-type literal union |
| `mint<keyof { 'has-dash': 1; 'has space': 2 }>()` | ✅ Quoted property names preserved as `['has space', 'has-dash']` |
| `mint<'a' \| undefined>()` | ✅ Emits `['a', undefined]` (literal `undefined`) |
| `mint<1n \| 2n \| 100n>()` | ✅ Bigint literals → `[1n, 2n, 100n]` (with `n` suffix) |
| `mint<-1 \| 0 \| 1>()` | ✅ Numbers sort numerically → `[-1, 0, 1]` |
| `mint<'café' \| '日本' \| 'apple'>()` | ✅ Non-ASCII literals OK; UTF-16 code-unit sort |
| `mint<string>()` | ❌ Open type — error with file:line + suggestion to narrow |
| `mint<number>()`, `mint<boolean>()`, `mint<bigint>()` | ❌ Same — any open primitive |
| `mint<any>()`, `mint<unknown>()` | ❌ Open type — same error class |
| `mint<'a' \| string>()` | ❌ Union widens to `string` — same error |
| `mint<\`${string}_${string}\`>()` | ❌ Infinite template-literal domain |
| `mint<never>()` | ❌ Empty union — "did you mean `[] as const`?" |
| `mint<{ a: 1; b: 2 }>()` | ❌ Object type — caught at type-check time |
| `mint<{kind:'a'} \| {kind:'b'}>()` | ❌ Object union — error suggesting `mint<U['kind']>()` |
| `type S = string; mint<S>()` | ❌ Same as `mint<string>()` after alias resolution |
| `function f<T>() { mint<T>() }` | ❌ Generic parameter unresolved at the call site |
| Cross-file: `T` defined in another module | ✅ ts-morph project graph resolves transitively |
| `import { default as m } from "mintz"; m<T>()` | ✅ Resolved by symbol identity |
| `import m from "mintz"; const M = m; M<T>()` | ⚠ Best-effort — alias-through-variable resolution depends on TS narrowing; documented as a known limitation |
| `function mint() {} mint<T>()` (local shadow) | ⏭ Skipped — symbol identity differs |
| Mixed: one aliased import + one direct in same file | ✅ Both resolve via symbol identity |
| Re-exported `mint` from a barrel | ✅ Symbol identity tracking handles transitive re-exports |
| Two `mint<>()` calls in one file | ✅ Each processed independently |
| Identical `mint<T>()` called twice | ✅ Both rewrite identically; deterministic ordering ensures stable diffs |
| Call inside a class method body | ✅ All call-site contexts supported |
| Call inside an object-literal property | ✅ Supported |
| Call inside an arrow-function body | ✅ Supported |
| Call inside a JSX attribute | ✅ Supported under `tsx`/`ctsx`/`mtsx` loader |
| Comment / JSDoc immediately before `mint<T>()` | ✅ Preserved across rewrite (codegen mode); has its own fixture |
| Call inside `.d.ts` declaration | ❌ Reject — declaration files cannot have runtime expressions |

### 7.1 Symbol-based call resolution

The engine uses ts-morph's symbol table to determine whether a call expression
is *actually* `mintz`'s default export. String-name matching would break for:

- Renamed imports: `import { default as foo } from "mintz"`
- Re-exports: `import m from "mintz"; export { m as bar };`
- Local shadowing: `function mint() { … }`

The cost is one extra type-checker call per candidate call site; the benefit
is correctness across all the tricky import patterns above.

### 7.2 Path aliases

The engine inherits whatever the project's tsconfig.json specifies for
`compilerOptions.paths`, `baseUrl`, and module resolution. ts-morph wires
these into its `Project` automatically.

---

## 8. Errors

### 8.1 Three modes, three channels

| Mode | Channel | Format |
|---|---|---|
| Bun plugin (errors) | Throw from `onLoad` → fails the build; the message lands in `result.logs` (after `Bun.build`) and stderr (under `bun run`) | `<file>:<line>:<col>: error: <reason>` |
| Bun plugin (warnings) | `console.warn(...)` — visible in build output but does not fail the build | Same line format, prefixed `warning:` |
| CLI | stderr; non-zero exit on any error | Same format. `--json` emits structured records (newline-delimited). |
| Runtime | `throw new MintzNotTransformedError(...)` | Multi-line message naming all setup paths + docs URL |

> **Why throw instead of pushing to a logs array?** Bun's plugin API does
> not currently expose a documented diagnostic-push surface for `onLoad`
> callbacks. Throwing is the only fail-the-build mechanism the plugin can
> rely on. If Bun later adds a structured diagnostics API, mintz can adopt
> it without breaking the user-facing contract.

### 8.2 Build-time error format

```
ERROR mintz: cannot resolve type at src/events.ts:14:34

  const events = mint<MaybeEvents>();
                       ^^^^^^^^^^^

  T resolved to: string | "lobby.reaction" | "system.ping"

  T contains the open type `string`, which has infinite values
  and cannot be enumerated. Narrow T to a finite union of
  literals.

  Possible fixes:
    • Use `Extract<MaybeEvents, "lobby.reaction" | "system.ping">`
      to be explicit about which members to keep.
    • Refactor the source type so MaybeEvents is itself a finite
      literal union.
```

Inspired by Rust's diagnostic style: error reason → context with caret →
resolved-type dump → suggestions.

### 8.3 Authored-time errors caught by TypeScript

The runtime stub's generic constraint produces normal TS errors for the most
common authoring mistake — passing a non-Lit type:

```ts
mint<{ a: 1 }>();
//   ^^^^^^^^ Type '{ a: 1; }' does not satisfy the constraint 'Lit'.
```

These show up with red squiggles in TypeScript-aware editors immediately,
before any build runs.

---

## 9. Testing strategy

Layered to catch regressions at each level of abstraction.

### 9.1 Engine unit tests (snapshot fixtures)

```
test/fixtures/
  ├── 01-string-union/
  │   ├── input.ts
  │   ├── expected.ts
  │   └── tsconfig.json
  ├── 02-numeric-enum/
  ├── 03-indexed-access/
  ├── 04-template-literal/
  ├── 05-keyof-typeof-enum/
  ├── 06-exclude/
  ├── 07-multiple-calls/
  ├── 08-renamed-import/
  ├── 09-re-export-barrel/
  ├── 10-tsx-jsx-attr/
  └── error/
      ├── 01-open-string/
      ├── 02-string-mixed-with-literal/
      ├── 03-infinite-template-literal/
      ├── 04-empty-never/
      ├── 05-unresolved-generic-param/
      └── 06-object-type/
```

Each fixture: `transform({ sourceText, filename, project }) === expected`.
Adding a new edge case = adding one directory.

### 9.2 Bun plugin integration tests

`bun test` spawns `Bun.build({ plugins: [mintz()] })` over fixture entry
points and asserts:
- bundle output contains the inlined arrays for success fixtures
- `result.logs` contains the expected error for error fixtures

### 9.3 CLI integration tests

`bun test` runs the `mintz` binary in tmpdirs containing fixture
projects and asserts stdout, stderr, exit code, and the on-disk source after
rewrite.

### 9.4 Type-level tests

Hand-rolled or via `tsd`:

- `mint<{ a: 1 }>()` produces the expected TS constraint error.
- `mint<'a' | 'b'>()` returns `readonly ('a' | 'b')[]`.
- The constraint catches the most common literal-violation patterns.

### 9.5 Test matrix

GitHub Actions matrix:
- **TypeScript:** `5.4.x` (floor — earlier minors had template-literal
  expansion bugs that affect this library), `5.6.x`, `5.8.x`, latest.
- **Runtime:** Bun stable, Bun canary (informational, not blocking),
  Node 20 LTS, Node 22 LTS.
- **OS:** Ubuntu (primary), macOS, Windows (covers atomic-write fallback
  path in §6.2).

All of layers 1–4 run in every cell. The TS version matrix is non-optional
because the type checker's behavior subtly evolves between minor versions —
the same library can produce different arrays under different TS versions.

**Supported TypeScript range** advertised to users: **>= 5.4**. Prior minors
may work in practice but are not tested or supported. The peer dependency
in `package.json` will pin `"typescript": ">=5.4"`.

---

## 10. Performance

### 10.1 Targets

- Plugin overhead on a file that does **not** use mintz: < 1 ms (bounded by
  the `indexOf` fast-skip and the file read).
- Plugin overhead on a file that **does** use mintz, on a warm `Project`:
  < 10 ms typical, < 50 ms tail.
- CLI cold start including tsconfig load and project scan: < 2 s on a
  medium repo (~500 .ts files).
- CLI warm `--watch` cycle (single file changed): < 100 ms.

### 10.2 Mechanisms

| Optimization | v1 | Notes |
|---|---|---|
| Fast-skip `indexOf("mintz")` | ✅ | Plugin is essentially free for non-mintz files. |
| One shared `Project` per tsconfig (cached) | ✅ | Avoid reloading the whole project per file. |
| Result cache keyed on (filename, content hash, mintz version) | optional v1 | In-memory; speeds up `--watch` re-runs. |
| Native NAPI `onBeforeParse` plugin (Rust) | v2 | Engine path is rare enough that JS is sufficient at v1. |
| Parallel CLI processing | optional v1 | ts-morph projects aren't thread-safe; would need a worker pool — defer unless slow. |

---

## 11. Open-source plan

### 11.1 Repository layout

```
mintz/
├── README.md             # value prop, install, 30-second example, comparison
├── LICENSE               # MIT
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── .github/
│   ├── workflows/
│   │   ├── ci.yml        # tests on push/PR; matrix
│   │   └── release.yml   # publish to npm on tag
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── src/
│   ├── runtime.ts
│   ├── errors.ts
│   ├── engine/
│   │   ├── index.ts
│   │   ├── ast.ts
│   │   ├── classify.ts
│   │   └── project-cache.ts
│   ├── bun/
│   │   └── index.ts
│   └── cli/
│       └── index.ts
├── test/
│   ├── fixtures/
│   ├── engine.test.ts
│   ├── bun-plugin.test.ts
│   ├── cli.test.ts
│   └── types.test.ts
├── examples/
│   ├── ws-events/        # the motivating wire-protocol case
│   ├── enum-replacement/
│   └── permissions-list/
├── docs/                 # if more than README warrants
├── package.json
├── tsconfig.json
└── bunfig.toml           # for development
```

If the project later splits (`@mintz/core`, `@mintz/bun`, `@mintz/unplugin`),
the current `src/` layout maps cleanly to packages.

### 11.2 README structure

1. **One-line tagline + one-paragraph value prop.** "Read your TypeScript
   types at runtime. Bun-native. Zero magic at the call site."
2. **30-second example.** Smallest install + one trivial `mint` call:
   ```ts
   import mint from "mintz";
   const colors = mint<'red' | 'green' | 'blue'>();
   // → ['blue', 'green', 'red']
   ```
   Lead with the trivial form, **not** the wire-protocol form. The
   wire-protocol pattern is the strongest motivator but it requires the
   reader to already have a discriminated union — that's a barrier to the
   30-second comprehension goal.
3. **The realistic example.** Show the wire-protocol case
   (`mint<ClientToServerEvent['kind']>()`) as the second example, with the
   discriminated-union setup. This is what users actually ship.
4. **Bun setup** — preload first (because `bun run` and `bun test` are the
   most common dev commands), build second. Copy-paste blocks for both.
5. **Node setup** (CLI codegen) — copy-paste blocks. Mention `mintz --check`
   prominently.
6. **Limitations** (before edge cases). Be upfront:
   - No resolution of generic parameters at the call site.
   - TypeScript-version skew — the resolved arrays must be tested across
     the supported TS range; document the range.
   - JavaScriptCore (Safari) and SpiderMonkey (Firefox) lack
     `Error.captureStackTrace`; runtime error messages still useful but
     omit call-site line.
   - Drift in codegen mode is real — describe it briefly and link to the
     full §4.8 in the design doc.
7. **Comparison table** with manual `as const`, typia, deepkit,
   ts-transformer-enumerate. Honest about each — see §11.7.
8. **Recipes** — common patterns (event names, enum values vs names, status
   codes, permissions, exclusion, drift detection in CI).
9. **API reference** — single page; the API is small.
10. **Edge cases & errors** — link to the design doc's §7 and §8.
11. **Versioning, support matrix, license, contributing.**

### 11.3 License

**MIT.** Default for the JS/TS ecosystem; matches typia, ts-morph, vite,
esbuild, biome. Maximum adoption friction-free.

### 11.4 Versioning

- v0.x while shaping the API; breaking changes allowed in minors.
- v1.0 corresponds to the goal set defined in §2 of this design doc, once
  the API is stable and the CI matrix is green for a release cycle.
- Strict semver from v1.

> **Note on "v1" usage in this document.** The term "v1" is used in two ways
> throughout this spec: (a) as the *milestone described by §2 goals* — what
> we plan to ship — and (b) as the *first stable npm release tagged 1.0.0*.
> The design's "v1 / v2" scoping (in §2 non-goals, §10 mechanisms, §13
> future work) refers to (a). Pre-1.0 releases on npm are 0.x and may break
> APIs as we shape them.

### 11.5 CI

GitHub Actions:
- `ci.yml`: on push and PR. Runs lint, typecheck, all four test layers
  across the TS-version × runtime matrix. Builds the package. Builds the
  examples.
- `release.yml`: on tag matching `v*`. Builds, runs CI, publishes to npm.
  Generates a release note from the changelog.

### 11.6 Distribution

- v1: npm only.
- v2: also publish to JSR (Deno-friendly registry, also serves Node/Bun).

### 11.7 Comparison positioning

The README must address head-on: *"why use mintz instead of typia / deepkit
/ a hand-written `as const` array?"*.

| | Manual `as const` | mintz | typia | deepkit | ts-transformer-enumerate |
|---|---|---|---|---|---|
| Single primitive (one function) | n/a (you write the array) | ✅ `mint<T>()` | ❌ wide API | ❌ framework | ⚠ `enumerate<T>()` for union only |
| Stays in sync with the type | ❌ manual | ✅ | ✅ | ✅ | ✅ |
| **Drift detection in CI** | ❌ | ✅ via `mintz --check` | n/a (always inlined at build) | n/a | n/a |
| Bun-first | n/a | ✅ native plugin | ⚠ via third-party `unplugin-typia/bun` | ⚠ via `@deepkit/bun` | ❌ no Bun support |
| Codegen mode (no build hook required) | n/a | ✅ CLI | ❌ transformer required | ❌ transformer required | ❌ transformer required |
| **Works under vanilla `tsc --build`** | ✅ | ✅ (after `mintz` runs) | ❌ unless `ts-patch` | ❌ unless transformer wired | ❌ unless `ts-patch` |
| Install size — production runtime | 0 | < 2 KB ¹ | runtime stub | runtime stub | runtime stub |
| Install size — dev (build) | 0 | ~5–10 MB ² | ~30 MB ³ | framework size | small but tooling-bound |
| Runtime overhead | 0 | 0 (build) / 1 ns (codegen) | 0 | minor | 0 |
| Validation included | ❌ | ❌ (not the goal) | ✅ | ✅ | ❌ |
| Effort to add a new value | manual (two places: type + array) | re-run `mintz` (or zero, in build mode) | zero | zero | zero |

¹ The `mintz` runtime stub is ~30 LOC of pure JS, no transitive deps.
² Includes `ts-morph` and `typescript` (peer). The CLI and plugin are
   build-time only and never reach production bundles.
³ typia includes its full AOT validation toolchain. Production builds drop
   most of it via tree-shaking; install-time disk usage is the larger figure.

`mintz` deliberately scopes itself smaller than typia. Users who need
runtime validation should still reach for typia, zod, valibot, or ArkType.
Users who only need their literal types as runtime arrays get a focused
tool — and, if they're on a vanilla `tsc` toolchain, the only option that
doesn't require `ts-patch` or a transformer plugin.

#### Drift detection: a unique capability worth its own pitch

Of the alternatives, only mintz offers a CI mechanism for catching the
"forgot to re-run codegen" hazard (§4.8). Build-mode transformers (typia,
deepkit, ts-transformer-enumerate) sidestep drift by inlining at every build,
but they require build-tooling buy-in. Manual `as const` arrays simply don't
have a "real" type to drift against. mintz's combination of *committed
codegen output* + *CI-time check* is genuinely a unique capability, not
parity with the field.

---

## 12. Open questions

Items deferred from design to plan / implementation:

- **Sourcemap handling — exact mechanism.** §2 commits sourcemap preservation
  to *best-effort* (not a guarantee). The plan must decide between:
  emitting a synthesized sourcemap that maps the inlined array bytes to the
  original `mint<T>()` line, vs relying on Bun's built-in sourcemap pipeline
  with no special handling. Implementation detail; both produce usable
  debugger experiences in practice.
- **`mint<T>()` in declaration files.** `.d.ts` cannot contain runtime
  expressions, so this is a hard error — but the engine should detect it
  early and report cleanly. Specific message format TBD.
- **Handling `as const` arrays inside the user's source as input.**
  E.g., `mint<typeof MY_ARR[number]>()`. Should already work via TS's
  `[number]` indexing, but worth a dedicated fixture to lock the behavior.
- **Result-cache invalidation key.** §10.2 lists an in-memory result cache
  keyed on (filename, content hash, mintz version). Open: also include
  resolved-types-of-imports hash, to invalidate when an upstream type
  changes? Likely yes for correctness; performance implications TBD.

---

## 13. Future work (v2+)

- **`unplugin` wrapper.** One implementation, six bundlers (Vite, Webpack,
  Rollup, esbuild, Rspack, Farm).
- **TypeScript transformer plugin** (`mintz/ts-transformer`) for users on
  `ts-patch` or `ttypescript`.
- **Native `onBeforeParse` Rust plugin** for Bun bundler — order-of-magnitude
  perf for large codebases.
- **JSR publication** for Deno and broader ecosystem reach.
- **Persistent on-disk cache** — only if cold-start perf becomes a problem.
- **Convenience helpers** if real users ask for them: `mintEntries<T>()` for
  `[name, value]` pairs from object types, `mintObject<T>()` for full const
  object snapshotting. Door is open but not assumed.
- **Resolution after monomorphization.** Today, `mint<T>()` inside a generic
  function body is rejected because `T` is unresolved at the static call
  site. A future engine could resolve after the type checker has
  monomorphized callers, emitting a generic stub that dispatches per-T at
  runtime. This is significant added complexity for a niche use case;
  considered, not committed.
- **Editor extensions** — e.g., a VS Code "show resolved values" hover that
  runs the engine for the type under the cursor.

---

## 14. Glossary

- **Lit** — the union
  `string | number | boolean | bigint | null | undefined`. Constraint
  for `mint<T>`.
- **Drift (codegen mode)** — the state where the embedded values array in
  `mint<T>(values)` no longer matches what `T` currently resolves to,
  typically because the user added a member to the union and forgot to
  re-run `mintz`. See §4.8.
- **Authored / codegen'd / inlined** — the three states a `mint<T>()` call
  can be in. See §4.2.
- **Engine** — the cross-runtime transform function that takes source text
  and produces source text plus diagnostics. See §3.1.
- **Project** — a ts-morph `Project` instance, the type-resolution context
  for a tsconfig.
- **Symbol identity** — ts-morph's notion of which declared binding a
  reference points to. Used to recognize `mint` calls regardless of import
  alias.
- **Fast-skip** — the `indexOf("mintz")` check that lets the plugin skip
  files that don't import the package.
