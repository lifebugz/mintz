export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly sourceLine: string;
  readonly caretLength: number;
  readonly resolvedType?: string;
  readonly suggestions?: readonly string[];
}

const DOCS_URL = "https://github.com/<user>/mintz#setup";

const NOT_TRANSFORMED_BODY = [
  "mint<T>() was called without runtime values. This means the",
  "build-time transform did not run on this file.",
  "",
  "To fix, choose one:",
  "  • Bun runtime/test:",
  "      Add a preload that registers the plugin:",
  "        // preload.ts",
  '        import { plugin } from "bun";',
  '        import mintz from "mintz/bun";',
  "        plugin(mintz());",
  "      Then in bunfig.toml:",
  '        preload = ["./preload.ts"]',
  "  • Bun bundler:",
  "      Add the plugin to Bun.build:",
  '        import mintz from "mintz/bun";',
  "        await Bun.build({ plugins: [mintz()], … });",
  "  • Node + tsc / ts-node / tsx:",
  "      Run `npx mintz` once to populate values.",
  '      Add to package.json:  "build": "mintz && tsc"',
  "  • CI:",
  "      Add `mintz --check` to fail PRs where source has drifted",
  "      from types.",
  "",
  `  See ${DOCS_URL}`,
].join("\n");

export class MintzNotTransformedError extends Error {
  override readonly name = "MintzNotTransformedError";
  readonly callSite: string | null;

  constructor() {
    let callSite: string | null = null;
    if (typeof Error.captureStackTrace === "function") {
      const probe: { stack?: string } = {};
      Error.captureStackTrace(probe, MintzNotTransformedError);
      callSite = extractFirstUserFrame(probe.stack);
    }
    const tail = callSite ? `\n  Call site: ${callSite}` : "";
    super(`${NOT_TRANSFORMED_BODY}${tail}`);
    this.callSite = callSite;
  }
}

function extractFirstUserFrame(stack: string | undefined): string | null {
  if (!stack) return null;
  const lines = stack.split("\n").slice(1);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.includes("node_modules")) continue;
    if (line.includes("runtime.ts")) continue;
    const m = /\((.+):(\d+):(\d+)\)$/.exec(line) ?? /at (.+):(\d+):(\d+)$/.exec(line);
    if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  }
  return null;
}

export function formatDiagnostic(d: Diagnostic): string {
  const label = d.severity === "error" ? "ERROR" : "WARNING";
  const header = `${label} mintz: ${d.message} at ${d.file}:${d.line}:${d.column}`;
  const caret = " ".repeat(Math.max(0, d.column - 1)) + "^".repeat(Math.max(1, d.caretLength));
  const lines: string[] = [header, "", `  ${d.sourceLine}`, `  ${caret}`];
  if (d.resolvedType) {
    lines.push("", `  T resolved to: ${d.resolvedType}`);
  }
  if (d.suggestions && d.suggestions.length > 0) {
    lines.push("", "  Possible fixes:");
    for (const s of d.suggestions) lines.push(`    • ${s}`);
  }
  return lines.join("\n");
}
