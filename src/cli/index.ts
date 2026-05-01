#!/usr/bin/env bun
import { Crust } from "@crustjs/core";
import { helpPlugin, versionPlugin } from "@crustjs/plugins";

const cli = new Crust("mintz")
  .use(helpPlugin())
  .use(versionPlugin("0.0.0"))
  .meta({
    description:
      "Rewrite mint<T>() calls to embed runtime literal arrays from your TypeScript types.",
  })
  .args([
    {
      name: "paths",
      type: "string",
      variadic: true,
      description: "Glob patterns of files to process. Default: src/**/*.{ts,tsx,mts,cts}",
    },
  ])
  .flags({
    check: {
      type: "boolean",
      default: false,
      description: "Read-only; exit non-zero if any file would change.",
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Print diffs but don't write.",
    },
    watch: {
      type: "boolean",
      default: false,
      description: "Re-run on file changes.",
    },
    tsconfig: {
      type: "string",
      description: "Path to tsconfig.json (default: walk up from cwd).",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit diagnostics as newline-delimited JSON.",
    },
    silent: {
      type: "boolean",
      default: false,
      description: "Suppress informational stdout.",
    },
  })
  .run(async ({ args, flags }) => {
    const { runRewrite } = await import("./rewrite");
    const { runCheck } = await import("./check");
    const { runWatch } = await import("./watch");

    const opts = {
      paths: args.paths,
      json: flags.json,
      silent: flags.silent,
      dryRun: flags["dry-run"],
      ...(flags.tsconfig !== undefined && { tsconfig: flags.tsconfig }),
    };

    if (flags.check) {
      process.exit(await runCheck(opts));
    } else if (flags.watch) {
      process.exit(await runWatch(opts));
    } else {
      process.exit(await runRewrite(opts));
    }
  });

await cli.execute();
