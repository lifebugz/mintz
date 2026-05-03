import type { LiteralValue } from "./types";

const KIND_ORDER: Record<LiteralValue["kind"], number> = {
  string: 0,
  number: 1,
  bigint: 2,
  boolean: 3,
  null: 4,
  undefined: 5,
};

export function sortLiterals(input: readonly LiteralValue[]): readonly LiteralValue[] {
  const seen = new Set<string>();
  const deduped: LiteralValue[] = [];
  for (const lit of input) {
    const key = stableKey(lit);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(lit);
  }
  return deduped.slice().sort(compare);
}

function compare(a: LiteralValue, b: LiteralValue): number {
  const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (ko !== 0) return ko;
  switch (a.kind) {
    case "string":
      // UTF-16 code-unit order matches JS default `<` operator.
      return a.value < (b as typeof a).value ? -1 : a.value > (b as typeof a).value ? 1 : 0;
    case "number":
      return a.value - (b as typeof a).value;
    case "bigint": {
      const bv = (b as typeof a).value;
      return a.value < bv ? -1 : a.value > bv ? 1 : 0;
    }
    case "boolean":
      // false (0) before true (1)
      return Number(a.value) - Number((b as typeof a).value);
    case "null":
    case "undefined":
      return 0;
  }
}

function stableKey(lit: LiteralValue): string {
  switch (lit.kind) {
    case "string":
      return `s:${lit.value}`;
    case "number":
      return `n:${lit.value}`;
    case "bigint":
      return `i:${lit.value.toString()}`;
    case "boolean":
      return `b:${lit.value}`;
    case "null":
      return "u";
    case "undefined":
      return "v";
  }
}
