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
  callee = "mint",
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
