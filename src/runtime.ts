import { MintzNotTransformedError } from "./errors";

export type Lit = string | number | boolean | bigint | null | undefined;

// Must be a `function` declaration (not arrow) to access `arguments.length`.
// `arguments.length` distinguishes "not invoked with values" from "invoked
// with values that happen to be undefined" — the latter is valid for
// `mint<'a' | undefined>(undefined)`. See spec §4.1.
function mint<T extends Lit>(values?: readonly T[]): readonly T[] {
  // The non-null assertion lies about the corner case `mint<T>(undefined)`
  // (where `values` really is undefined). That call shape is impossible in
  // well-formed user code: the build/codegen transform either inlines the
  // array (state 3) or produces `mint<T>([...])` (state 2). The narrower
  // public type matches the contract every real caller sees.
  if (arguments.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: see comment above
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return values!;
  }
  throw new MintzNotTransformedError();
}

export { mint };
export default mint;
