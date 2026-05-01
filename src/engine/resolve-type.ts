import type { Type } from "ts-morph";
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

  // `boolean` IS a union of `true | false`; treat it specially BEFORE
  // checking unions so we can drill in (ts-morph treats boolean as
  // non-union sometimes).
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
          "Use `Extract<T, <finite-union>>` to keep only the literal members.",
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
              "If T is a discriminated union of objects, use indexed access on the discriminator: `mint<U['kind']>()`.",
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
    return { kind: "boolean", value: t.getText() === "true" };
  }
  if (t.compilerType.isLiteral() && typeof t.compilerType.value === "object") {
    // BigIntLiteralType: value is { negative, base10Value }
    const v = t.compilerType.value;
    const big = (v.negative ? -1n : 1n) * BigInt(v.base10Value);
    return { kind: "bigint", value: big };
  }
  if ((t.compilerType.flags & /* TypeFlags.Null */ 8) !== 0) {
    return { kind: "null" };
  }
  if ((t.compilerType.flags & /* TypeFlags.Undefined */ 4) !== 0) {
    return { kind: "undefined" };
  }
  // Open primitives.
  if (t.isString() || t.isNumber() || t.isBoolean() || t.isAny() || t.isUnknown()) {
    return "open";
  }
  if ((t.compilerType.flags & /* TypeFlags.BigInt */ 64) !== 0) {
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
    ...(args.resolvedType && { resolvedType: args.resolvedType }),
    ...(args.suggestions && { suggestions: args.suggestions }),
  };
  return { ok: false, diagnostic };
}
