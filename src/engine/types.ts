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
