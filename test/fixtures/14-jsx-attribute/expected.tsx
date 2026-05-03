import mint from "mintz";

const colors = ["blue", "green", "red"] as const;

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
