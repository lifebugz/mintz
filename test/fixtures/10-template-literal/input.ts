import mint from "mintz";

export const events = mint<`evt.${"a" | "b"}.${"start" | "end"}`>();
