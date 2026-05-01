import mint from "mintz";

enum Color {
  Red = "red",
  Blue = "blue",
  Green = "green",
}

export const values = ["blue", "green", "red"] as const;
export const names = ["Blue", "Green", "Red"] as const;
