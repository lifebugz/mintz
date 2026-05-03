# mintz

Read your TypeScript types at runtime. Bun-native. Zero magic at the call site.

## Why it exists

TypeScript types are erased at runtime. There is no native operator to enumerate
a literal union as a `string[]`. Existing solutions either embed this capability
inside a much larger framework (typia, deepkit), or require a TypeScript compiler
transformer that Bun does not natively support (ts-transformer-enumerate via
ts-patch / ttypescript). `mintz` is the focused library that does only this, with
first-class Bun integration and a CLI that works under any toolchain.

## Quick example

```ts
import mint from "mintz";

const colors = mint<"red" | "green" | "blue">();
// → ['blue', 'green', 'red']
```

The realistic case — enumerating the discriminator of a discriminated union:

```ts
import mint from "mintz";

type ClientToServerEvent =
  | { event: "lobby.reaction"; emoji: string }
  | { event: "player.typing"; isTyping: boolean }
  | { event: "round.submit_answers"; answers: string[] }
  | { event: "system.ping"; ts: number };

const events = mint<ClientToServerEvent["event"]>();
// → ['lobby.reaction', 'player.typing', 'round.submit_answers', 'system.ping']
```

The type already contains the union you want. `mint<T>()` is just the last hop —
turning it into a runtime array.

## Install

```sh
bun add mintz
```

Peer dependency: `typescript >= 5.4`.

## Three modes

### Bun preload (recommended for `bun run` and `bun test`)

Create a preload file and register the plugin:

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

The plugin resolves `T` on every module load and replaces each `mint<T>()` call
with an inlined `[...] as const`. No drift is possible — the array is always
fresh from the type checker.

### Bun build plugin

```ts
// build.ts
import mintz from "mintz/bun";
await Bun.build({
  entrypoints: ["./src/app.ts"],
  outdir: "./dist",
  plugins: [mintz()],
});
```

Same plugin, same behavior. `mint<T>()` collapses to a bare array literal in the
bundle. Zero runtime cost; the function is never invoked.

### CLI codegen (any toolchain)

For projects using `tsc`, `ts-node`, `tsx`, Webpack, or Vite — any toolchain
that doesn't support Bun plugins:

```sh
npx mintz            # rewrite all mint<T>() calls in src/**/*.{ts,tsx}
npx mintz --check    # CI: exit non-zero if any file is out of sync
npx mintz --watch    # re-run on file changes during development
```

After running `mintz`, each call site becomes:

```ts
const events = mint<ClientToServerEvent["event"]>([
  "lobby.reaction",
  "player.typing",
  "round.submit_answers",
  "system.ping",
]);
```

The values are embedded in source and committed to your repo. Re-running `mintz`
recomputes them — the call preserves the type expression so codegen can re-read
it on every run.

**Important:** in codegen mode, if you add a member to the type and forget to
re-run `mintz`, the committed array silently drifts behind the type. TypeScript
does not catch this. Add `mintz --check` to your CI pipeline to catch drift
before it ships:

```json
{
  "scripts": {
    "build": "mintz && tsc",
    "ci:check": "mintz --check && tsc --noEmit"
  }
}
```

## What `T` can be

`T` must resolve to a finite union of literal types. TypeScript's existing
operators do the routing:

```ts
// Direct literal union
mint<"a" | "b" | "c">();

// Indexed access on a discriminated union
mint<ClientToServerEvent["event"]>();

// keyof an interface or const object
mint<keyof Config>();
mint<keyof typeof MY_CONST>();

// Values of an enum-like const object
mint<(typeof Status)[keyof typeof Status]>();

// Template literals (must resolve to a finite domain)
mint<`evt.${"a" | "b"}`>(); // → ['evt.a', 'evt.b']

// Filtering
mint<Exclude<Color, "deprecated">>();
```

Both import styles work:

```ts
import mint from "mintz"; // default
import { mint } from "mintz"; // named
```

**Out of scope for v0.1:** open types (`string`, `number`, `any`, `unknown`),
unresolved generic parameters at the call site, and types that widen to a
non-literal union. These produce a build-time error with a suggested fix rather
than a TypeScript type error. Non-`Lit` types (objects, arrays, classes) are
caught at type-check time with a normal red squiggle.

Output is sorted deterministically on every run — strings by UTF-16 code-unit
order, numbers numerically, booleans with `false` first — so re-running `mintz`
produces byte-identical output and git diffs reflect only real type changes.

## What it is not

`mintz` does not validate runtime data. It has no runtime type guards, no JSON
schema generation, and no serialization support. For those, reach for zod,
typia, valibot, or ArkType.

It is not a full reflection framework. deepkit and typia provide complete
type-based runtime systems; `mintz` provides one primitive.

It is not a TypeScript decorator polyfill and has no opinion on decorators.

## Status

v0.1.0, pre-1.0. Semver permits breaking changes in 0.x minors while the API
is being shaped. Feedback and bug reports welcome via
[GitHub Issues](https://github.com/lifebugz/mintz/issues).

## License

MIT (see [LICENSE](./LICENSE)).
