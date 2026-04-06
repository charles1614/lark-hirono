/**
 * analyze command — analyze markdown structure.
 *
 * Usage:
 *   lark-hirono analyze input.md
 */

import { readFileSync } from "node:fs";
import { analyzeMarkdown } from "../core/analyze.js";
import { normalizeMarkdown } from "../core/normalize.js";

export async function run(args: string[]): Promise<number> {
  const positional: string[] = [];

  for (const a of args) {
    if (a === "--help" || a === "-h") {
      showHelp();
      return 0;
    }
    if (!a.startsWith("-")) {
      positional.push(a);
    }
  }

  if (positional.length < 1) {
    console.error("Error: Missing input file");
    console.error("Usage: lark-hirono analyze <input.md>");
    return 1;
  }

  const inputPath = positional[0];
  const src = readFileSync(inputPath, "utf-8");
  const { text: normalized } = normalizeMarkdown(src);
  const analysis = analyzeMarkdown(normalized);

  console.log(JSON.stringify({
    document_type: analysis.documentType,
    tables: `${analysis.tableCount}/${analysis.tableRows} rows`,
    headings: analysis.headingCount,
    callouts: analysis.calloutCount,
  }, null, 2));

  return 0;
}

function showHelp(): void {
  console.log(`
lark-hirono analyze — Analyze markdown document structure

Usage:
  lark-hirono analyze <input.md>

Output:
  JSON object with document type, table/heading counts, and optimization suggestions.
`);
}
