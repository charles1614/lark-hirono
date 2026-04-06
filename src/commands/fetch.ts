/**
 * fetch command — retrieve Feishu document as markdown.
 *
 * Usage:
 *   lark-hirono fetch --doc <doc-id>
 *   lark-hirono fetch --doc <doc-id> --output out.md
 */

import { writeFileSync } from "node:fs";
import { LarkCli } from "../cli.js";

export async function run(args: string[]): Promise<number> {
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      showHelp();
      return 0;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["verbose"].includes(key)) {
        flags[key] = true;
      } else {
        flags[key] = args[++i] ?? "";
      }
    } else {
      // Treat positional arg as doc-id if not set
      if (!flags["doc"]) flags["doc"] = a;
    }
  }

  const docId = flags["doc"] as string;
  const output = flags["output"] as string;

  if (!docId) {
    console.error("Error: --doc required");
    console.error("Usage: lark-hirono fetch --doc <doc-id> [--output file.md]");
    return 1;
  }

  const cli = new LarkCli({ retries: 3 });
  try {
    cli.status();
  } catch (err) {
    console.error(`Auth error: ${(err as Error).message}`);
    return 1;
  }

  const markdown = cli.fetchDoc(docId);
  if (!markdown) {
    console.error("Failed to fetch document");
    return 1;
  }

  if (output) {
    writeFileSync(output, markdown, "utf-8");
    console.log(`Fetched ${docId} → ${output}`);
  } else {
    process.stdout.write(markdown);
  }

  return 0;
}

function showHelp(): void {
  console.log(`
lark-hirono fetch — Retrieve Feishu document as markdown

Usage:
  lark-hirono fetch --doc <doc-id> [--output file.md]

Options:
  --doc <id>      Document ID (required)
  --output <file> Save to file (default: stdout)

Config:
  Reads lark-hirono.json from current directory or ancestors.
`);
}
