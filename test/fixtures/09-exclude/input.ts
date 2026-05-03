import mint from "mintz";

type Status = "active" | "pending" | "deprecated" | "archived";

export const live = mint<Exclude<Status, "deprecated" | "archived">>();
