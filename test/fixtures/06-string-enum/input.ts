import mint from "mintz";

enum Color {
  Red = "red",
  Blue = "blue",
  Green = "green",
}

export const values = mint<Color>();
export const names = mint<keyof typeof Color>();
