/**
 * optimize command — update or clone-then-optimize Feishu documents.
 *
 * Usage:
 *   lark-hirono optimize --doc <doc-id>                    # fetch → transform → update in place
 *   lark-hirono optimize --doc <doc-id> --input input.md   # file → transform → update in place
 *   lark-hirono optimize --doc <doc-id> --new              # fetch → transform → create sibling
 *   lark-hirono optimize --doc <doc-id> --new --title X    # create sibling with custom title
 */

import { loadConfig } from "../config.js";
import { runPipeline, type PipelineArgs } from "../pipeline.js";

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
      if (["verify", "verbose", "no-highlight", "new"].includes(key)) {
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

  const docId = flags["doc"] as string;
  const input = positional[0] || (flags["input"] as string) || "";
  const doFetch = !input;
  const createNew = Boolean(flags["new"]);

  if (!docId) {
    console.error("Error: --doc required");
    console.error("Usage: lark-hirono optimize --doc <doc-id> [--new] [--input input.md]");
    return 1;
  }

  const config = loadConfig({
    wikiSpace: flags["wiki-space"] as string | undefined,
    wikiNode: flags["wiki-node"] as string | undefined,
    bgMode: flags["bg-mode"] as "light" | "dark" | undefined,
    highlight: flags["no-highlight"] ? false : undefined,
  });

  // --new creates a sibling doc, uses the same wiki-space/parent as source
  const pipelineArgs: PipelineArgs = {
    mode: createNew ? "create" : "update",
    docId: createNew ? undefined : docId,
    sourceDocId: docId,
    fetch: doFetch,
    input,
    title: (flags["title"] as string) ?? "",
    wikiSpace: config.wikiSpace,
    wikiNode: config.wikiNode,
    imageDir: config.imageDir,
    stripTitle: config.stripTitle,
    bgMode: config.bgMode,
    highlight: config.highlight,
    verify: Boolean(flags.verify),
    analyzeOnly: false,
    dryRun: false,
    verbose: Boolean(flags.verbose),
    createNew,
  };

  const result = await runPipeline(pipelineArgs);
  return result.ok ? 0 : 1;
}

function showHelp(): void {
  console.log(`
lark-hirono optimize — Update or clone-then-optimize Feishu documents

Usage:
  lark-hirono optimize --doc <doc-id> [options]

Options:
  --doc <id>            Document ID (required)
  --input <file>        Local markdown file to use as source (default: fetch from doc)
  --new                 Create a new sibling doc instead of updating in place
  --title <title>       Title for new sibling doc (default: original title + " (optimized)")
  --wiki-space <id>     Wiki space ID (default: from config)
  --wiki-node <id>      Parent wiki node ID (default: same as source doc)
  --bg-mode <mode>      Heading background mode: light | dark
  --verify              Fetch and verify document after update
  --no-highlight        Skip keyword highlighting
  -v, --verbose         Verbose logging

Modes:
  Default:            Fetches doc, applies transforms, updates in place
  --input <file>:     Uses local file, applies transforms, updates doc
  --new:              Fetches doc, applies transforms, creates NEW sibling doc

Config:
  Reads lark-hirono.json from current directory or ancestors.
`);
}