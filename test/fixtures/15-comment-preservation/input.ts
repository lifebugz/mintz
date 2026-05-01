import mint from "mintz";

/** All event names accepted by the server. */
export const events = mint<"start" | "stop">();
