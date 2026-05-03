import mint from "mintz";

type ClientToServerEvent =
  | { kind: "lobby.reaction"; payload: number }
  | { kind: "system.ping" }
  | { kind: "round.submit"; turn: number };

export const eventNames = mint<ClientToServerEvent["kind"]>();
