/**
 * Markdown normalizer — clean markdown for Feishu docx API.
 *
 * Ported from feishu_tool.py normalize_markdown_for_feishu.
 */

import { normalizeHeadingNumbers } from "./headings.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface NormalizationReport {
  tableSeparatorFixed: number;
  duplicateLooseMetaRemoved: boolean;
  htmlPresent: boolean;
}

// ─── Normalize ──────────────────────────────────────────────────────────

/**
 * Normalize table separator rows.
 * Feishu requires `|---|---|` but users may write `| --- | --- |`.
 */
function normalizeTableSeparators(lines: string[]): { lines: string[]; count: number } {
  let count = 0;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    // Match separator rows: | --- | --- | or |:---|:---|
    if (/^\|[\s:]*-+[\s:]*\|/.test(trimmed) && !/[a-zA-Z]/.test(trimmed.replace(/---/g, ""))) {
      const cells = trimmed.split("|").filter(Boolean);
      const normalized = "|" + cells.map((c) => c.trim().replace(/^-+$/, "---").replace(/^:-+$/, ":---").replace(/^-+:$/, "---:").replace(/^:-+:$/, ":---:")).join("|") + "|";
      if (normalized !== line.trim()) {
        count++;
        return normalized;
      }
    }
    return line;
  });
  return { lines: out, count };
}

/**
 * Remove duplicate loose metadata blocks.
 * Sometimes the same metadata appears twice (e.g., from copy-paste).
 */
function removeDuplicateLooseMetadata(mdText: string): { text: string; removed: boolean } {
  // Match repeated "<!-- metadata -->" blocks
  const metaPattern = /^(<!--[\s\S]*?-->)\s*\n\1\s*\n/gm;
  const result = mdText.replace(metaPattern, "$1\n");
  return { text: result, removed: result !== mdText };
}

/**
 * Lint markdown for common Feishu issues.
 * Returns list of warnings (informational only).
 */
export function lintMarkdown(mdText: string): string[] {
  const warnings: string[] = [];

  // Check for bare code blocks (no language tag)
  const bareFence = /^```\s*$/gm;
  const matches = mdText.match(bareFence);
  if (matches) {
    warnings.push(`${matches.length} bare code block(s) without language tag`);
  }

  // Check for LaTeX inside blockquotes
  if (/^>.*\$[^$]+\$/.test(mdText)) {
    warnings.push("LaTeX found inside blockquote — may not render correctly");
  }

  // Check for escaped pipes in tables
  if (/^\|.*\\\|.*\|/m.test(mdText)) {
    warnings.push("Escaped pipe (\\|) in table cells — may cause parsing issues");
  }

  // Check for <br/> tags (handled in lark-table cells, but warn for doc-level usage)
  if (/<br\s*\/?>/i.test(mdText)) {
    warnings.push("<br/> tags found — will be handled in lark-table cells");
  }

  return warnings;
}

/**
 * Unescape \| → | inside lark-table blocks.
 * In markdown tables, | is a cell delimiter so unescaping would break parsing.
 * Safe to call twice: before lark-table conversion (no-op for markdown tables)
 * and after (converts escaped pipes in lark-table cells).
 * Code fences are always skipped.
 */
export function unescapePipes(md: string): string {
  const blocks = md.split(/(```[\s\S]*?```)/g);
  return blocks.map(block => {
    if (block.startsWith("```")) return block;
    if (!/<lark-table[\s>]/.test(block)) return block;
    return block.replace(/\\\|/g, "|");
  }).join("");
}

/**
 * Full normalization pipeline.
 */
export function normalizeMarkdown(mdText: string): { text: string; report: NormalizationReport } {
  const report: NormalizationReport = {
    tableSeparatorFixed: 0,
    duplicateLooseMetaRemoved: false,
    htmlPresent: false,
  };

  // 1. Normalize table separators
  const lines = mdText.split("\n");
  const sep = normalizeTableSeparators(lines);
  report.tableSeparatorFixed = sep.count;
  let result = sep.lines.join("\n");

  // 2. Remove duplicate loose metadata
  const meta = removeDuplicateLooseMetadata(result);
  result = meta.text;
  report.duplicateLooseMetaRemoved = meta.removed;

  // 3. Detect HTML presence
  report.htmlPresent = /<[^>]+>/.test(result);

  // 4. Clean HTML tags (lark-table conversion preserves them in cells)
  result = result.replace(/<p>(.*?)<\/p>/gis, "$1 ");
  result = result.replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  result = result.replace(/<\/?ul>/gi, "");
  result = result.replace(/<\/?ol>/gi, "");
  result = result.replace(/<li>/gi, "- ");
  result = result.replace(/<\/li>/gi, "\n");
  result = result.replace(/<\/?p>/gi, "");
  result = result.replace(/<\/?strong>/gi, "**");
  result = result.replace(/<\/?em>/gi, "*");
  result = result.replace(/<\/?b>/gi, "**");
  result = result.replace(/<\/?i>/gi, "*");

  // 5. Normalize heading numbers (Chinese ordinals → Arabic, fix duplicates)
  result = normalizeHeadingNumbers(result);

  return { text: result, report };
}

/**
 * Bold table header cells (rows directly above a separator row).
 */
export function boldTableHeaders(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const nextLine = lines[i + 1]?.trim() ?? "";
    if (/^\|[-:| ]+\|$/.test(nextLine) && trimmed.startsWith("|") && !trimmed.includes("---")) {
      const cells = lines[i].split("|");
      out.push(cells.map((c) => {
        const t = c.trim();
        return t && !t.startsWith("**") ? c.replace(t, `**${t}**`) : c;
      }).join("|"));
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n");
}

/**
 * Convert bullet placeholder __BULLET__ to separate lines.
 * Only affects content outside lark-table blocks.
 * Must run AFTER convertToLarkTables.
 */
export function splitInlineBullets(md: string): string {
  const blocks = md.split(/(<lark-table[\s\S]*?<\/lark-table>)/);
  return blocks.map(block => {
    if (block.startsWith("<lark-table")) return block;
    return block.replace(/\s*__BULLET__\s*/g, "\n- ");
  }).join("");
}
