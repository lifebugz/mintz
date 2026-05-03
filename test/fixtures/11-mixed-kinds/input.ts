import mint from "mintz";

export const mixed = mint<"a" | 1 | true | null | undefined | 2n>();
