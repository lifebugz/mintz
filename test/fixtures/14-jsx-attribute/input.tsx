import mint from "mintz";

const colors = mint<"red" | "green" | "blue">();

export function Picker() {
  return (
    <select>
      {colors.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
