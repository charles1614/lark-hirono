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
 * Apply a transformation to segments outside markdown table rows.
 * Table rows (lines starting and ending with |) are preserved as-is
 * so lark-table can process their HTML content later.
 */
function processOutsideTableCells(md: string, fn: (s: string) => string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let outside: string[] = [];

  const flush = () => {
    if (outside.length > 0) {
      const transformed = fn(outside.join("\n"));
      out.push(...transformed.split("\n"));
      outside = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\|.*\|$/.test(trimmed) || /^\|[\s:]*-+[\s:]*\|/.test(trimmed)) {
      flush();
      out.push(line);
    } else {
      outside.push(line);
    }
  }
  flush();
  return out.join("\n");
}

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

  // 4. Clean HTML tags.
  //    Table cells are handled separately: <li>/<ul>/<br> inside |...| rows
  //    are preserved for lark-table cell processing (which converts them to
  //    inline format so newlines don't break table row parsing).
  // 4a. <br>/<p> → newline (outside tables)
  //     <p> is a block-level element, should produce newlines like <br>.
  //     Inside table cells, <p> is preserved for lark-table cell processing.
  result = processOutsideTableCells(result, (segment) => {
    // Protect inline code from HTML conversion
    const codeSpans: string[] = [];
    segment = segment.replace(/`[^`]+`/g, (m) => {
      codeSpans.push(m);
      return `\x00CODE${codeSpans.length - 1}\x00`;
    });

    segment = segment.replace(/<br\s*\/?>/gi, "\n");
    // <p>content</p> → content + newline (block-level → line break)
    segment = segment.replace(/<p>(.*?)<\/p>/gis, "$1\n");
    // Strip any remaining stray <p> or </p>
    segment = segment.replace(/<\/?p>/gi, "");
    // Strip empty <li></li>
    segment = segment.replace(/<li>\s*<\/li>/gi, "");
    // Convert <li> to markdown bullets (native Feishu list)
    segment = segment.replace(/<li>/gi, "\n- ");
    segment = segment.replace(/<\/li>/gi, "");
    // Add newline after closing list tags before removing them,
    // so text following </ul> doesn't glue to the last bullet
    segment = segment.replace(/<\/ul>\s*/gi, "\n");
    segment = segment.replace(/<\/ol>\s*/gi, "\n");
    segment = segment.replace(/<\/?ul>/gi, "");
    segment = segment.replace(/<\/?ol>/gi, "");

    // Restore inline code
    segment = segment.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeSpans[parseInt(i)]);
    return segment;
  });
  // 4b. Links (global — safe everywhere).
  //     <p>/<\/p> are preserved inside table cells — lark-table.ts handles them.
  result = result.replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // 4c. Add blank lines between consecutive non-blank, non-special lines
  //     to preserve paragraph breaks in Feishu
  const normalLines = result.split("\n");
  const withBreaks: string[] = [];
  let inCodeFence = false;
  for (let i = 0; i < normalLines.length; i++) {
    const line = normalLines[i];
    const trimmed = line.trim();
    const nextTrimmed = normalLines[i + 1]?.trim() || "";

    if (trimmed.startsWith("```")) inCodeFence = !inCodeFence;

    withBreaks.push(line);

    // Skip blank-line injection inside code fences
    if (inCodeFence) continue;

    // Add blank line after non-empty lines that:
    // - are not headings, list items, code blocks, blockquotes, or separators
    // - followed by another non-empty line of the same type
    if (
      trimmed &&
      nextTrimmed &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("-") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith(">") &&
      !trimmed.startsWith("```") &&
      !trimmed.startsWith("---") &&
      !trimmed.startsWith("|") &&
      !nextTrimmed.startsWith("#") &&
      !nextTrimmed.startsWith("-") &&
      !nextTrimmed.startsWith("*") &&
      !nextTrimmed.startsWith(">") &&
      !nextTrimmed.startsWith("```") &&
      !nextTrimmed.startsWith("---") &&
      !nextTrimmed.startsWith("|")
    ) {
      // Check if this looks like a short standalone line (paragraph break candidate)
      // Heuristic: lines < 80 chars that end without punctuation
      if (trimmed.length < 80 && !/[。！？.!?]$/.test(trimmed)) {
        withBreaks.push("");
      }
    }
  }
  result = withBreaks.join("\n");

  // Collapse excess blank lines (3+ = 2 is too many; allow paragraph breaks)
  result = result.replace(/\n{4,}/g, "\n\n");
  // 4c-d. Remaining inline HTML — skip code fences and lark-table blocks
  const blocks = result.split(/(```[\s\S]*?```|<lark-table[\s\S]*?<\/lark-table>)/g);
  result = blocks.map(block => {
    if (block.startsWith("```") || block.startsWith("<lark-table")) return block;
    // Protect inline code from HTML conversion
    const codeSpans: string[] = [];
    block = block.replace(/`[^`]+`/g, (m) => {
      codeSpans.push(m);
      return `\x00CODE${codeSpans.length - 1}\x00`;
    });
    block = block.replace(/<\/?strong>/gi, "**");
    block = block.replace(/<\/?em>/gi, "*");
    block = block.replace(/<\/?b>/gi, "**");
    block = block.replace(/<\/?i>/gi, "*");
    block = block.replace(/<\/?u>/gi, "");
    block = block.replace(/<\/?s>/gi, "~~");
    block = block.replace(/<\?xml[^>]*>/gi, "");
    block = block.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeSpans[parseInt(i)]);
    return block;
  }).join("");

  // 5. Fix Feishu markdown parsing issue with --- separators
  // Feishu interprets text before --- as a heading unless there's a blank line
  // Fix: Ensure blank line before --- separator
  // Match pattern: text\n--- and replace with text\n\n---\n
  const allLines = result.split("\n");
  const fixed: string[] = [];
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const nextLine = allLines[i + 1] || "";
    fixed.push(line);
    // If current line is text (not blank) and next line is ---
    if (line.trim() && line.trim() !== "---" && nextLine.trim() === "---") {
      // Add blank line before ---
      fixed.push("");
    }
  }
  result = fixed.join("\n");

  // 6. Normalize heading numbers (Chinese ordinals → Arabic, fix duplicates)
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
