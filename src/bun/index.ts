import type { BunPlugin } from "bun";
import { transform } from "../engine";
import { getOrCreateProject } from "../engine/project-cache";
import { formatDiagnostic } from "../errors";

export interface MintzPluginOptions {
  /** Path to tsconfig.json. Default: walk up from each file. */
  readonly tsconfig?: string;
  /** Override default file filter. */
  readonly include?: RegExp;
  /** Module name to detect imports of. Default: "mintz". */
  readonly mintzModulePath?: string;
}

export default function mintzPlugin(opts: MintzPluginOptions = {}): BunPlugin {
  const filter = opts.include ?? /\.[mc]?tsx?$/;
  const moduleName = opts.mintzModulePath ?? "mintz";

  return {
    name: "mintz",
    setup(build) {
      build.onLoad({ filter, namespace: "file" }, async ({ path }) => {
        const source = await Bun.file(path).text();
        if (!source.includes(moduleName)) return;

        const project = getOrCreateProject(opts.tsconfig, path);
        const result = transform({
          source,
          filename: path,
          project,
          mode: "inline",
          mintzModulePath: moduleName,
        });

        const errors = result.diagnostics.filter((d) => d.severity === "error");
        if (errors.length > 0) {
          throw new Error(errors.map((d) => formatDiagnostic(d)).join("\n\n"));
        }
        for (const d of result.diagnostics) {
          if (d.severity === "warning") console.warn(formatDiagnostic(d));
        }
        if (!result.modified) return;
        return {
          contents: result.code,
          loader: pickLoader(path),
        };
      });
    },
  };
}

function pickLoader(path: string): "ts" | "tsx" {
  return /tsx$/i.test(path) ? "tsx" : "ts";
}
