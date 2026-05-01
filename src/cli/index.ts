#!/usr/bin/env node
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "mintz",
    version: "0.0.0",
    description:
      "Rewrite mint<T>() calls to embed runtime literal arrays from your TypeScript types.",
  },
  args: {
    paths: {
      type: "positional",
      description: "Glob patterns of files to process. Default: src/**/*.{ts,tsx,mts,cts}",
      required: false,
    },
    check: {
      type: "boolean",
      description: "Read-only; exit non-zero if any file would change.",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      description: "Print diffs but don't write.",
      default: false,
    },
    watch: {
      type: "boolean",
      description: "Re-run on file changes.",
      default: false,
    },
    tsconfig: {
      type: "string",
      description: "Path to tsconfig.json (default: walk up from cwd).",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Emit diagnostics as newline-delimited JSON.",
      default: false,
    },
    silent: {
      type: "boolean",
      description: "Suppress informational stdout.",
      default: false,
    },
  },
  async run({ args }) {
    const paths = args._ ?? [];
    const { runRewrite } = await import("./rewrite");
    const { runCheck } = await import("./check");
    const { runWatch } = await import("./watch");

    const opts = {
      paths,
      tsconfig: args.tsconfig,
      json: args.json,
      silent: args.silent,
      dryRun: args["dry-run"],
    };

    if (args.check) {
      process.exit(await runCheck(opts));
    } else if (args.watch) {
      process.exit(await runWatch(opts));
    } else {
      process.exit(await runRewrite(opts));
    }
  },
});

void runMain(main);
