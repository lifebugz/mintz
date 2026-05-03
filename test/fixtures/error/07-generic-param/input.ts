import mint from "mintz";

export function f<T extends string>() {
  return mint<T>();
}
