import mint from "mintz";

type Status = "active" | "pending" | "deprecated" | "archived";

export const live = ["active", "pending"] as const;
