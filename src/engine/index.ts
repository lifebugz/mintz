import { type CallExpression, type Project, type SourceFile } from "ts-morph";
import type { Diagnostic } from "../errors";
import { sortLiterals } from "./classify";
import { emitInlineArray, emitWrappedCall } from "./emit";
import { findMintCalls } from "./find-calls";
import { resolveTypeToLiterals } from "./resolve-type";
import type { LiteralValue, TransformResult } from "./types";

export interface TransformOptions {
  readonly source: string;
  readonly filename: string;
  readonly project: Project;
  readonly mode: "inline" | "wrapped";
  /** Module path mintz resolves from. Default: "mintz". */
  readonly mintzModulePath?: string;
}

export function transform(opts: TransformOptions): TransformResult {
  // Fast-skip: avoid AST parse if file doesn't even mention "mintz".
  const mintzMod = opts.mintzModulePath ?? "mintz";
  if (!opts.source.includes(mintzMod)) {
    return { code: opts.source, modified: false, diagnostics: [] };
  }

  const existing = opts.project.getSourceFile(opts.filename);
  let file: SourceFile;
  if (existing) {
    existing.replaceWithText(opts.source);
    file = opts.project.getSourceFileOrThrow(opts.filename);
  } else {
    file = opts.project.createSourceFile(opts.filename, opts.source, {
      overwrite: true,
    });
  }

  const calls = findMintCalls(file, mintzMod);
  if (calls.length === 0) {
    return { code: file.getFullText(), modified: false, diagnostics: [] };
  }

  // Reject calls in declaration files.
  if (opts.filename.endsWith(".d.ts")) {
    return {
      code: opts.source,
      modified: false,
      diagnostics: [
        callDiagnostic(file, calls[0]!, {
          code: "DECL_FILE",
          message: "mint<T>() cannot be used in declaration (.d.ts) files.",
        }),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  // Process calls in reverse order so earlier text replacements
  // don't shift later positions.
  const sortedCalls = calls.slice().sort((a, b) => b.getStart() - a.getStart());

  for (const call of sortedCalls) {
    const typeArg = call.getTypeArguments()[0];
    if (!typeArg) {
      diagnostics.push(
        callDiagnostic(file, call, {
          code: "MISSING_TYPE_ARG",
          message: "mint<T>() requires a type argument.",
        }),
      );
      continue;
    }

    const resolution = resolveTypeToLiterals(typeArg.getType());
    if (!resolution.ok) {
      diagnostics.push(enrichDiagnostic(file, call, resolution.diagnostic));
      continue;
    }

    const sorted = sortLiterals(resolution.literals);
    const replacement = renderReplacement(call, typeArg.getText(), sorted, opts.mode);
    if (replacement !== call.getText()) {
      call.replaceWithText(replacement);
    }
  }

  const newText = file.getFullText();
  return {
    code: newText,
    modified: newText !== opts.source && diagnostics.every((d) => d.severity !== "error"),
    diagnostics,
  };
}

function renderReplacement(
  call: CallExpression,
  typeArgText: string,
  literals: readonly LiteralValue[],
  mode: "inline" | "wrapped",
): string {
  if (mode === "inline") {
    return emitInlineArray(literals);
  }
  // Wrapped (codegen) mode: keep the user's callee identifier (handles
  // renamed imports like `import { default as m } from "mintz"`).
  const callee = call.getExpression().getText();
  return emitWrappedCall(typeArgText, literals, callee);
}

function callDiagnostic(
  file: SourceFile,
  call: CallExpression,
  d: Pick<Diagnostic, "code" | "message">,
): Diagnostic {
  const start = call.getStart();
  const { line, column } = file.getLineAndColumnAtPos(start);
  const sourceLine = lineAtPos(file.getFullText(), start);
  return {
    severity: "error",
    code: d.code,
    message: d.message,
    file: file.getFilePath(),
    line,
    column,
    sourceLine,
    caretLength: call.getWidth(),
  };
}

function enrichDiagnostic(file: SourceFile, call: CallExpression, base: Diagnostic): Diagnostic {
  const start = call.getStart();
  const { line, column } = file.getLineAndColumnAtPos(start);
  return {
    ...base,
    file: file.getFilePath(),
    line,
    column,
    sourceLine: lineAtPos(file.getFullText(), start),
    caretLength: call.getWidth(),
  };
}

function lineAtPos(text: string, pos: number): string {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const end = text.indexOf("\n", pos);
  return text.slice(start, end === -1 ? text.length : end);
}
