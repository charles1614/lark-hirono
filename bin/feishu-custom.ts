/**
 * Feishu-Custom CLI entry point.
 * Parses arguments and runs the pipeline.
 */

import { log, initLogging } from "../src/logging.js";
import { runPipeline } from "../src/pipeline.js";

async function main() {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["dry-run", "verify", "verbose", "strip-title", "analyze", "no-highlight"].includes(key)) {
        flags[key] = true;
      } else {
        flags[key] = args[++i] ?? "";
      }
    } else if (a === "-v") {
      flags.verbose = a;
    } else {
      positional.push(a);
    }
  }

  if (positional.length < 1) {
    console.error("Usage: feishu-custom <input.md> [title] [--options]");
    process.exit(1);
  }

  initLogging(Boolean(flags.verbose));

  const result = await runPipeline({
    input: positional[0],
    title: positional[1] ?? "",
    wikiSpace: (flags["wiki-space"] as string) || "7620053427331681234",
    wikiNode: (flags["wiki-node"] as string) || "UNtHwabqNiqc8ZkzvLscWNnwnYd",
    imageDir: (flags["image-dir"] as string) || null,
    stripTitle: Boolean(flags["strip-title"]),
    bgMode: (flags["bg-mode"] as "light" | "dark") || "light",
    highlight: !flags["no-highlight"],
    verify: Boolean(flags.verify),
    analyzeOnly: Boolean(flags.analyze),
    dryRun: Boolean(flags["dry-run"]),
    verbose: Boolean(flags.verbose),
  });

  if (!result.ok) {
    process.exit(1);
  }
}

main();
