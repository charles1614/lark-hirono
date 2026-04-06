/**
 * upload command — preprocess + upload + patch.
 *
 * Usage:
 *   lark-hirono upload input.md [--title "Title"] [--dry-run] [--verify] ...
 */

import { runPipeline, type PipelineArgs } from "../pipeline.js";
import { loadConfig } from "../config.js";

export async function run(args: string[]): Promise<number> {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      showHelp();
      return 0;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["dry-run", "verify", "verbose", "strip-title", "no-highlight"].includes(key)) {
        flags[key] = true;
      } else {
        flags[key] = args[++i] ?? "";
      }
    } else if (a === "-v") {
      flags.verbose = true;
    } else {
      positional.push(a);
    }
  }

  if (positional.length < 1) {
    console.error("Error: Missing input file");
    console.error("Usage: lark-hirono upload <input.md> [--title \"Title\"] [options]");
    return 1;
  }

  const config = loadConfig({
    wikiSpace: flags["wiki-space"] as string | undefined,
    wikiNode: flags["wiki-node"] as string | undefined,
    bgMode: flags["bg-mode"] as "light" | "dark" | undefined,
    highlight: flags["no-highlight"] ? false : undefined,
    stripTitle: flags["strip-title"] ? true : undefined,
    imageDir: flags["image-dir"] as string | undefined,
  });

  const pipelineArgs: PipelineArgs = {
    input: positional[0],
    title: (positional[1] as string) ?? (flags["title"] as string) ?? "",
    wikiSpace: config.wikiSpace,
    wikiNode: config.wikiNode,
    imageDir: config.imageDir,
    stripTitle: config.stripTitle,
    bgMode: config.bgMode,
    highlight: config.highlight,
    verify: Boolean(flags.verify),
    analyzeOnly: false,
    dryRun: Boolean(flags["dry-run"]),
    verbose: Boolean(flags.verbose),
  };

  const result = await runPipeline(pipelineArgs);
  return result.ok ? 0 : 1;
}

function showHelp(): void {
  console.log(`
lark-hirono upload — Upload markdown as styled Feishu document

Usage:
  lark-hirono upload <input.md> [title] [options]

Options:
  --title <title>       Document title (default: first H1 in markdown)
  --wiki-space <id>     Wiki space ID (default: from config or built-in)
  --wiki-node <id>      Parent wiki node ID (default: from config or built-in)
  --bg-mode <mode>      Heading background mode: light | dark (default: light)
  --image-dir <dir>     Directory for downloaded images
  --dry-run             Preprocess only, print markdown to stdout
  --verify              Fetch and verify document after upload
  --no-highlight        Skip keyword highlighting
  --strip-title         Remove first H1 heading
  -v, --verbose         Verbose logging

Config:
  Reads lark-hirono.json from current directory or ancestors.
`);
}
