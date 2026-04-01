/**
 * Title highlight — extract table titles, apply LLM-selected keywords as {red:**keyword**}.
 *
 * Ported from feishu_tool.py cmd_highlight.
 *
 * Workflow:
 *   1. highlightExtract() → JSON batches of {code, title}
 *   2. (LLM selects keywords from batches — external step)
 *   3. highlightApply() → wrap matched keywords in {red:**keyword**}
 */

import { readFileSync, writeFileSync } from "node:fs";

// ─── Types ──────────────────────────────────────────────────────────────

export interface TitleEntry {
  code: string;
  title: string;
}

export interface KeywordEntry {
  code: string;
  keyword: string;
}

// ─── Table Row Splitting ────────────────────────────────────────────────

/** Split a markdown table row, respecting escaped \| pipes. */
function splitTableRow(line: string): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  let i = 0;

  while (i < line.length) {
    if (i + 1 < line.length && line[i] === "\\" && line[i + 1] === "|") {
      current.push("|");
      i += 2;
    } else if (line[i] === "|") {
      parts.push(current.join(""));
      current = [];
      i++;
    } else {
      current.push(line[i]);
      i++;
    }
  }
  parts.push(current.join(""));
  return parts;
}

// ─── Extract ────────────────────────────────────────────────────────────

/**
 * Extract titles from markdown tables for LLM keyword selection.
 *
 * Assumes first column is code, second column is title.
 * Returns batches of {code, title} entries.
 */
export function highlightExtract(
  mdText: string,
  batchSize = 200
): TitleEntry[][] {
  const lines = mdText.split("\n");
  const titles: TitleEntry[] = [];
  let inTable = false;

  for (const line of lines) {
    const s = line.trim();

    // Table separator row
    if (s.startsWith("|") && s.includes("---")) {
      inTable = true;
      continue;
    }

    // Skip header rows (bold column names)
    if (s.startsWith("|") && s.includes("**Code**")) {
      continue;
    }

    // Data row
    if (inTable && s.startsWith("|")) {
      const cells = splitTableRow(s).map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        const code = cells[0];
        let title = cells[1];
        // Remove existing {red:**...**} tags
        title = title.replace(/\{red:\*\*([^*]+)\*\*\}/g, "$1");
        titles.push({ code, title });
      }
      continue;
    }

    // End of table
    if (!s.startsWith("|") && inTable) {
      inTable = false;
    }
  }

  // Split into batches
  const batches: TitleEntry[][] = [];
  for (let i = 0; i < titles.length; i += batchSize) {
    batches.push(titles.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Save extraction batches to JSON files.
 * Returns the list of created file paths.
 */
export function saveBatches(
  batches: TitleEntry[][],
  inputPath: string
): string[] {
  const paths: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const filePath = `${inputPath}.keywords_batch_${i}.json`;
    writeFileSync(filePath, JSON.stringify(batches[i], null, 2), "utf-8");
    paths.push(filePath);
  }
  return paths;
}

// ─── Apply ──────────────────────────────────────────────────────────────

/**
 * Apply keywords from JSON back to markdown.
 * Wraps matched keywords in {red:**keyword**} within title columns.
 */
export function highlightApply(
  mdText: string,
  keywords: KeywordEntry[]
): { markdown: string; applied: number } {
  const kwMap = new Map<string, string>();
  for (const kw of keywords) {
    if (kw.keyword) kwMap.set(kw.code, kw.keyword);
  }

  const lines = mdText.split("\n");
  const outLines: string[] = [];
  let inTable = false;
  let applied = 0;

  for (const line of lines) {
    const s = line.trim();

    // Table separator
    if (s.startsWith("|") && s.includes("---")) {
      outLines.push(line);
      inTable = true;
      continue;
    }

    // Header row
    if (s.startsWith("|") && s.includes("**Code**")) {
      outLines.push(line);
      continue;
    }

    // Data row
    if (inTable && s.startsWith("|")) {
      const cells = splitTableRow(line);
      if (cells.length >= 3) {
        const code = cells[1].trim();
        let title = cells[2];
        // Strip existing {red:**...**} to prevent nesting
        title = title.replace(/\{red:\*\*([^*]+)\*\*\}/g, "$1");
        const keyword = kwMap.get(code);

        if (keyword) {
          // Try exact match (case-insensitive)
          const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const pattern = new RegExp(escaped, "i");
          const newTitle = title.replace(pattern, `{red:**${keyword}**}`);

          if (newTitle !== title) {
            cells[2] = " " + newTitle + " ";
            applied++;
          } else {
            // Try first significant word of keyword (>3 chars)
            for (const w of keyword.split(/\s+/)) {
              if (w.length > 3) {
                const wp = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
                const wt = title.replace(wp, `{red:**${w}**}`);
                if (wt !== title) {
                  cells[2] = " " + wt + " ";
                  applied++;
                  break;
                }
              }
            }
          }
        }
        outLines.push(cells.join("|"));
      } else {
        outLines.push(line);
      }
      continue;
    }

    // End of table
    if (!s.startsWith("|") && inTable) {
      inTable = false;
    }

    outLines.push(line);
  }

  return { markdown: outLines.join("\n"), applied };
}

// ─── CLI ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: highlight.ts <input.md> --extract [--batch-size N]");
    console.error("       highlight.ts <input.md> --apply keywords.json [--inplace]");
    process.exit(1);
  }

  const inputPath = args[0];
  const content = readFileSync(inputPath, "utf-8");

  if (args.includes("--extract")) {
    const batchIdx = args.indexOf("--batch-size");
    const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) || 200 : 200;
    const batches = highlightExtract(content, batchSize);
    const paths = saveBatches(batches, inputPath);
    const total = batches.reduce((n, b) => n + b.length, 0);
    console.error(`Total: ${total} titles in ${batches.length} batch(es)`);
    for (let i = 0; i < batches.length; i++) {
      console.error(`Batch ${i}: ${batches[i].length} titles → ${paths[i]}`);
    }
  } else if (args.includes("--apply")) {
    const kwIdx = args.indexOf("--apply");
    const kwPath = args[kwIdx + 1];
    const keywords: KeywordEntry[] = JSON.parse(readFileSync(kwPath, "utf-8"));
    const { markdown, applied } = highlightApply(content, keywords);
    const inplace = args.includes("--inplace");

    if (inplace) {
      writeFileSync(inputPath, markdown, "utf-8");
      console.error(`Applied ${applied} highlights → ${inputPath}`);
    } else {
      process.stdout.write(markdown);
    }
    console.error(`Applied: ${applied}/${keywords.length} keywords`);
  } else {
    console.error("Use --extract to extract titles or --apply keywords.json to apply");
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("highlight.ts")) {
  main();
}
