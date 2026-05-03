# mintz

Read TypeScript types at runtime, on Bun.

## Why it exists

TypeScript types are erased at compile time. If you have a literal union
like `"red" | "green" | "blue"` and you want the values back as an array
at runtime, there's nothing built in. typia and deepkit can do it, but
they're full frameworks. `ts-transformer-enumerate` can do it, but it
needs ts-patch / ttypescript, and Bun doesn't run those. So this is just
the part you actually wanted.

## Quick example

```ts
import mint from "@mintz/core";

const colors = mint<"red" | "green" | "blue">();
// → ['blue', 'green', 'red']
```

A more useful case: pulling the discriminator out of a discriminated union.

```ts
import mint from "@mintz/core";

type ClientToServerEvent =
  | { event: "lobby.reaction"; emoji: string }
  | { event: "player.typing"; isTyping: boolean }
  | { event: "round.submit_answers"; answers: string[] }
  | { event: "system.ping"; ts: number };

const events = mint<ClientToServerEvent["event"]>();
// → ['lobby.reaction', 'player.typing', 'round.submit_answers', 'system.ping']
```

The type already encodes the union. `mint<T>()` just turns it into a runtime
array.

## Install

```sh
bun add @mintz/core
```

You also need `typescript >= 5.4` as a peer dep.

## Three modes

### Bun preload (recommended for `bun run` and `bun test`)

Create a preload file that registers the plugin:

```ts
// preload.ts
import { plugin } from "bun";
import mintz from "@mintz/core/bun";
plugin(mintz());
```

```toml
# bunfig.toml
preload = ["./preload.ts"]

[test]
preload = ["./preload.ts"]
```

On every module load, the plugin re-resolves `T` and rewrites each
`mint<T>()` to an inline `[...] as const`. The array stays in sync with
the type, and you don't commit anything generated.

### Bun build plugin

```ts
// build.ts
import mintz from "@mintz/core/bun";
await Bun.build({
  entrypoints: ["./src/app.ts"],
  outdir: "./dist",
  plugins: [mintz()],
});
```

In a build, the call collapses to a literal array. The runtime function
is never invoked.

### CLI codegen (anything that isn't Bun)

If you're on `tsc`, `ts-node`, `tsx`, Webpack, or Vite:

```sh
npx mintz            # rewrite every mint<T>() in src/**/*.{ts,tsx}
npx mintz --check    # CI: exit non-zero if any file is out of sync
npx mintz --watch    # re-run on changes during development
```

After running `mintz`, each call site looks like this:

```ts
const events = mint<ClientToServerEvent["event"]>([
  "lobby.reaction",
  "player.typing",
  "round.submit_answers",
  "system.ping",
]);
```

The values get committed to your repo. The type expression stays alongside
them so the next run can re-read it.

Codegen mode has one real failure mode: you change the type, forget to
re-run, and the committed array silently drifts. TypeScript won't catch
this. Wire `mintz --check` into CI:

```json
{
  "scripts": {
    "build": "mintz && tsc",
    "ci:check": "mintz --check && tsc --noEmit"
  }
}
```

## What `T` can be

`T` has to resolve to a finite union of literals. Anything TypeScript
can already compute into one works:

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

Both import shapes work:

```ts
import mint from "@mintz/core"; // default
import { mint } from "@mintz/core"; // named
```

What's out of scope for v0.1: open types (`string`, `number`, `any`,
`unknown`), generic parameters that aren't resolved at the call site, and
types that widen to a non-literal union. These produce a build-time error
with a suggested fix, not a TypeScript type error. Object, array, and class
types fail at type-check time the normal way (red squiggle).

Output is sorted on every run: strings by UTF-16 code-unit order, numbers
numerically, booleans with `false` first. So `mintz` is byte-stable across
runs and your git diffs only move when the type actually changed.

## What it is not

`mintz` doesn't validate runtime data. No type guards, no JSON schema, no
serialization. For that, reach for zod, typia, valibot, or ArkType.

It's also not a reflection framework. typia and deepkit provide the full
type-based runtime; `mintz` does one primitive. And it has no opinion on
decorators.

## Status

v0.1.0, pre-1.0. The 0.x minors may break. File issues at
[GitHub](https://github.com/lifebugz/mintz/issues).

## License

MIT (see [LICENSE](./LICENSE)).
