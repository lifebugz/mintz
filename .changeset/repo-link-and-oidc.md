---
"@mintz/core": patch
---

Add `repository`, `homepage`, and `bugs` fields to `package.json` so npmjs.com renders the GitHub repository link and consumers' tools (Dependabot, IDE auto-completers, `bun info`, `npm info`) can find the source.

Internal: this version is also the first published via the OIDC + Trusted Publishing pipeline. v0.1.0 was bootstrapped via a transitional NPM_TOKEN; v0.1.1+ ships with cryptographic provenance attestation linking each release tarball to the exact GitHub commit and CI run that produced it.
