/**
 * highlight command — extract table titles for keyword selection, or apply keywords.
 *
 * Usage:
 *   lark-hirono highlight extract input.md [--batch-size N]
 *   lark-hirono highlight apply input.md keywords.json [--inplace]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { highlightExtract, highlightApply, saveBatches } from "../core/highlight.js";

export async function run(args: string[]): Promise<number> {
  const subcommand = args[0];

  switch (subcommand) {
    case "extract":
      return runExtract(args.slice(1));
    case "apply":
      return runApply(args.slice(1));
    case "--help":
    case "-h":
      showHelp();
      return 0;
    default:
      console.error(`Unknown highlight subcommand: ${subcommand}`);
      showHelp();
      return 1;
  }
}

function runExtract(args: string[]): number {
  const positional: string[] = [];
  let batchSize = 200;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      showExtractHelp();
      return 0;
    }
    if (a === "--batch-size") {
      batchSize = parseInt(args[++i], 10) || 200;
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }

  if (positional.length < 1) {
    console.error("Error: Missing input file");
    console.error("Usage: lark-hirono highlight extract <input.md>");
    return 1;
  }

  const content = readFileSync(positional[0], "utf-8");
  const batches = highlightExtract(content, batchSize);
  const paths = saveBatches(batches, positional[0]);
  const total = batches.reduce((n, b) => n + b.length, 0);
  console.log(`Total: ${total} titles in ${batches.length} batch(es)`);
  for (let i = 0; i < batches.length; i++) {
    console.log(`Batch ${i}: ${batches[i].length} titles → ${paths[i]}`);
  }
  console.log(`\nNext: Send JSON files to LLM, then save as ${positional[0]}.selected_keywords.json`);
  return 0;
}

function runApply(args: string[]): number {
  const positional: string[] = [];
  const flags: Record<string, boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      showApplyHelp();
      return 0;
    }
    if (a === "--inplace") {
      flags.inplace = true;
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }

  if (positional.length < 2) {
    console.error("Error: Missing input file or keywords file");
    console.error("Usage: lark-hirono highlight apply <input.md> <keywords.json>");
    return 1;
  }

  const inputPath = positional[0];
  const kwPath = positional[1];
  const content = readFileSync(inputPath, "utf-8");
  const keywords = JSON.parse(readFileSync(kwPath, "utf-8"));
  const { markdown, applied } = highlightApply(content, keywords);

  if (flags.inplace) {
    writeFileSync(inputPath, markdown, "utf-8");
    console.log(`Applied ${applied} highlights → ${inputPath}`);
  } else {
    process.stdout.write(markdown);
  }
  console.error(`Applied: ${applied}/${(keywords as any[]).length} keywords`);
  return 0;
}

function showHelp(): void {
  console.log(`
lark-hirono highlight — Extract table titles or apply keywords

Usage:
  lark-hirono highlight extract <input.md> [--batch-size N]
  lark-hirono highlight apply <input.md> <keywords.json> [--inplace]

Subcommands:
  extract  Extract table titles for LLM keyword selection
  apply    Apply keyword highlights from JSON file

Workflow:
  1. highlight extract → saves .keywords_batch_N.json files
  2. (Send to LLM, save response as .selected_keywords.json)
  3. lark-hirono create → automatically applies highlights if keyword file exists
`);
}

function showApplyHelp(): void {
  console.log(`
lark-hirono highlight apply — Apply keyword highlights from JSON

Usage:
  lark-hirono highlight apply <input.md> <keywords.json> [--inplace]

Options:
  --inplace  Write changes back to input file (default: stdout)
`);
}

function showExtractHelp(): void {
  console.log(`
lark-hirono highlight extract — Extract table titles for LLM selection

Usage:
  lark-hirono highlight extract <input.md> [--batch-size N]

Options:
  --batch-size  Max titles per batch file (default: 200)
`);
}
