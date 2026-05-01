import mint from "mintz";

enum Direction {
  North,
  South,
  East,
  West,
}

export const dirValues = mint<Direction>();
export const dirNames = mint<keyof typeof Direction>();
