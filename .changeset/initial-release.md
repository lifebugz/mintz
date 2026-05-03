---
"mintz": minor
---

Initial public release of `mintz`.

`mintz` reads your TypeScript types at runtime — Bun-native, with zero magic
at the call site.

### Engine
- Resolves generic type parameters to concrete literal values via the
  TypeScript checker
- Deterministic literal sort and dedup for byte-stable output
- Find / resolve / classify / emit pipeline integrated into `transform()`

### Bun integration
- Plugin factory for Bun build mode and `bunfig.toml` `preload` mode
- Preload mode rewrites `mint<T>()` call sites at module-load time

### CLI
- `mintz check` — drift detection (exits non-zero if generated output
  differs from what the transform would emit; suitable for CI gating)
- `mintz` (default) — rewrite mode with atomic writes
- `mintz --watch` — continuous regeneration on file changes
