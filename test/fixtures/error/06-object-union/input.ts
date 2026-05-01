import mint from "mintz";

type U = { kind: "a" } | { kind: "b" };

export const x = mint<U>();
