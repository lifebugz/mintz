import mint from "mintz";

enum Direction {
  North,
  South,
  East,
  West,
}

export const dirValues = [0, 1, 2, 3] as const;
export const dirNames = ["East", "North", "South", "West"] as const;
