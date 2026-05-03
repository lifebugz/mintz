# mintz

## 0.1.1

### Patch Changes

- f444f48: Add `repository`, `homepage`, and `bugs` fields to `package.json` so npmjs.com renders the GitHub repository link and consumers' tools (Dependabot, IDE auto-completers, `bun info`, `npm info`) can find the source.

  Internal: this version is also the first published via the OIDC + Trusted Publishing pipeline. v0.1.0 was bootstrapped via a transitional NPM_TOKEN; v0.1.1+ ships with cryptographic provenance attestation linking each release tarball to the exact GitHub commit and CI run that produced it.

## 0.1.0

### Minor Changes

- 4b786d4: Initial public release of `mintz`.

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
