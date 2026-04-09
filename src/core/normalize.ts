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
  addOnsMermaidConverted: number;
  mermaidThemeApplied: number;
  calloutDslConverted: number;
}

// ─── Add-ons → Mermaid ──────────────────────────────────────────────────────

const MERMAID_COMPONENT_TYPE = "blk_631fefbbae02400430b8f9f4";
const MERMAID_STAGE_FILL = "#f7f9ff";
const MERMAID_STAGE_STROKE = "#d6def2";
const MERMAID_ENDPOINT_FILL = "#fff4df";
const MERMAID_ENDPOINT_STROKE = "#f4ead0";
export const MERMAID_EDGE_LABEL_BG = "#f4deff";
const MERMAID_ENDPOINT_KEYWORDS = /\b(input|output|start|end|source|sink|entry|exit|ingress|egress)\b/i;

interface MermaidNodeRef {
  id: string;
  label: string;
}

function stripWrappingQuotes(label: string): string {
  if (
    (label.startsWith("\"") && label.endsWith("\"")) ||
    (label.startsWith("'") && label.endsWith("'"))
  ) {
    return label.slice(1, -1);
  }
  return label;
}

function stripBoldMarkdown(label: string): string {
  const trimmed = label.trim();
  if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  return trimmed;
}

function boldTopLevelSubgraphLabel(line: string): string {
  const match = line.match(/^(\s*subgraph\s+)([A-Za-z][A-Za-z0-9_:.:-]*)(?:\s+(.*?))?\s*$/);
  if (!match) return line;

  const [, prefix, id, rawLabel] = match;
  if (!rawLabel) return line;

  let label = rawLabel.trim();
  if (label.startsWith("[") && label.endsWith("]")) {
    label = label.slice(1, -1).trim();
  }
  label = stripWrappingQuotes(stripBoldMarkdown(label));
  if (!label) return line;

  return `${prefix}${id} ["**${label}**"]`;
}

function extractNodeRef(segment: string, fromStart: boolean): MermaidNodeRef | null {
  const cleaned = fromStart ? segment.trimStart().replace(/^\|[^|]*\|\s*/, "") : segment.trimEnd();
  const pattern = fromStart
    ? /^([A-Za-z][A-Za-z0-9_]*)(?:\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\})?(?:::[A-Za-z][A-Za-z0-9_-]*)?/
    : /([A-Za-z][A-Za-z0-9_]*)(?:\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\})?(?:::[A-Za-z][A-Za-z0-9_-]*)?\s*$/;
  const match = cleaned.match(pattern);
  if (!match) return null;

  const id = match[1];
  const label = (match[2] ?? match[3] ?? match[4] ?? id).trim();
  return { id, label };
}

function findArrowIndex(line: string): { index: number; token: string } | null {
  const tokens = ["-.->", "-->", "==>"];
  let best: { index: number; token: string } | null = null;
  for (const token of tokens) {
    const index = line.indexOf(token);
    if (index !== -1 && (!best || index < best.index)) best = { index, token };
  }
  return best;
}

export function applyMermaidTheme(source: string): { text: string; themed: boolean } {
  const lines = source.split("\n");
  const initDirective = `%%{init: {"theme":"base"} }%%`;
  const bodyStart =
    lines[0]?.trim().startsWith("%%{init:") ? 1 : 0;
  const graphHeader = lines[bodyStart] ?? "";
  const graphBody = lines.slice(bodyStart + 1);
  const topLevelSubgraphs: string[] = [];
  const indegree = new Map<string, number>();
  const outdegree = new Map<string, number>();
  const labels = new Map<string, string>();

  let depth = 0;
  const themedBody = graphBody.map((line) => {
    const trimmed = line.trim();

    if (/^subgraph\s+/.test(trimmed)) {
      const isTopLevel = depth === 0;
      depth++;
      if (isTopLevel) {
        const subgraphMatch = trimmed.match(/^subgraph\s+([A-Za-z][A-Za-z0-9_:.:-]*)/);
        if (subgraphMatch) topLevelSubgraphs.push(subgraphMatch[1]);
        return boldTopLevelSubgraphLabel(line);
      }
      return line;
    }

    if (trimmed === "end" && depth > 0) {
      depth--;
      return line;
    }

    if (!trimmed || trimmed.startsWith("%%") || trimmed.startsWith("style ")) return line;

    const arrow = findArrowIndex(line);
    if (!arrow) return line;

    const left = extractNodeRef(line.slice(0, arrow.index), false);
    const right = extractNodeRef(line.slice(arrow.index + arrow.token.length), true);
    if (!left || !right) return line;

    labels.set(left.id, left.label);
    labels.set(right.id, right.label);
    outdegree.set(left.id, (outdegree.get(left.id) ?? 0) + 1);
    indegree.set(right.id, (indegree.get(right.id) ?? 0) + 1);
    indegree.set(left.id, indegree.get(left.id) ?? 0);
    outdegree.set(right.id, outdegree.get(right.id) ?? 0);
    return line;
  });

  const sourceSinkIds = Array.from(new Set([...indegree.keys(), ...outdegree.keys()])).filter((id) => {
    return (indegree.get(id) ?? 0) === 0 || (outdegree.get(id) ?? 0) === 0;
  });
  const keywordEndpoints = sourceSinkIds.filter((id) => MERMAID_ENDPOINT_KEYWORDS.test(labels.get(id) ?? ""));
  const endpointIds = keywordEndpoints.length > 0 ? keywordEndpoints : sourceSinkIds.length <= 2 ? sourceSinkIds : [];

  const targetStyleIds = new Set([...topLevelSubgraphs, ...endpointIds]);
  const filteredBody = themedBody.filter((line) => {
    const match = line.trim().match(/^style\s+([A-Za-z][A-Za-z0-9_:.:-]*)\s+/);
    return !match || !targetStyleIds.has(match[1]);
  });

  const styleLines = [
    ...topLevelSubgraphs.map((id) =>
      `style ${id} fill:${MERMAID_STAGE_FILL},stroke:${MERMAID_STAGE_STROKE},stroke-width:2px,font-weight:bold`,
    ),
    ...endpointIds.map((id) =>
      `style ${id} fill:${MERMAID_ENDPOINT_FILL},stroke:${MERMAID_ENDPOINT_STROKE},stroke-width:2px`,
    ),
  ];

  const nextLines = [initDirective, graphHeader, ...filteredBody, "", ...styleLines]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  if (styleLines.length === 0 && nextLines === [initDirective, ...lines].join("\n")) {
    return { text: source, themed: false };
  }
  return { text: nextLines, themed: styleLines.length > 0 || nextLines !== source };
}

export function themeMermaidFences(md: string): { text: string; themed: number } {
  let themed = 0;
  const text = md.replace(/```mermaid\n([\s\S]*?)\n```/g, (_, body: string) => {
    const result = applyMermaidTheme(body);
    if (result.themed) themed++;
    return `\`\`\`mermaid\n${result.text}\n\`\`\``;
  });
  return { text, themed };
}

/**
 * Convert Feishu <add-ons> mermaid blocks to ```mermaid fences.
 *
 * Fetch returns mermaid diagrams as a single-line tag:
 *   <add-ons component-type-id="blk_631fefbbae02400430b8f9f4" record="{"data":"graph TD\n...","theme":"base","view":"chart"}"/>
 *
 * lark-cli docs +create (v1.0.6+) accepts ```mermaid fences and creates whiteboard blocks.
 * This conversion enables round-trip upload of mermaid diagrams.
 *
 * JSON.parse handles \n → newline and \u003e → > inside the data field automatically.
 */
export function convertAddOnsToMermaid(md: string): { text: string; converted: number } {
  let converted = 0;
  const lines = md.split("\n");
  const out = lines.map((line) => {
    if (!line.includes("<add-ons") || !line.includes(MERMAID_COMPONENT_TYPE)) return line;
    if (!line.trimEnd().endsWith('"/>')) return line;

    const recordMarker = 'record="';
    const rPos = line.indexOf(recordMarker);
    if (rPos === -1) return line;

    const jsonStart = rPos + recordMarker.length;
    // The line ends with }"/> — strip the closing "/> (2 chars) + closing " of attribute (1 char)
    const jsonStr = line.slice(jsonStart, line.length - 3);

    try {
      const record = JSON.parse(jsonStr) as { data?: string };
      if (typeof record.data !== "string") return line;
      converted++;
      return "```mermaid\n" + record.data + "\n```";
    } catch {
      return line;
    }
  });
  return { text: out.join("\n"), converted };
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
 * Convert [!callout attrs]...content...[/callout] DSL to <callout attrs>...content...</callout> XML.
 *
 * The bracket DSL is an alternative authoring syntax (also appears in some Feishu exports).
 * Converting it early ensures all downstream steps (hasOpeningCallout, injectOpeningCallout,
 * convertBlockquotesToCallouts) see a single canonical XML form.
 */
export function convertCalloutDslToXml(md: string): { text: string; converted: number } {
  let converted = 0;
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.trim().match(/^\[!callout([^\]]*)\]$/);

    if (match) {
      // Lookahead: verify a standalone [/callout] line exists before the next [!callout or EOF.
      // Without this, an orphaned [!callout] tag (e.g. inside a corrupted <callout> XML block)
      // would consume the entire rest of the document as callout body.
      let closingIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "[/callout]") { closingIdx = j; break; }
        if (lines[j].trim().match(/^\[!callout/)) break; // next DSL tag — this one is unclosed
      }

      if (closingIdx === -1) {
        // Malformed / orphaned opening tag — pass through unchanged
        out.push(line);
        i++;
      } else {
        const attrs = match[1];
        const contentLines = lines.slice(i + 1, closingIdx);
        out.push(`<callout${attrs}>`);
        out.push(...contentLines);
        out.push(`</callout>`);
        converted++;
        i = closingIdx + 1; // skip past [/callout]
      }
    } else {
      out.push(line);
      i++;
    }
  }

  return { text: out.join("\n"), converted };
}

/**
 * Full normalization pipeline.
 */
export function normalizeMarkdown(mdText: string): { text: string; report: NormalizationReport } {
  const report: NormalizationReport = {
    tableSeparatorFixed: 0,
    duplicateLooseMetaRemoved: false,
    htmlPresent: false,
    addOnsMermaidConverted: 0,
    mermaidThemeApplied: 0,
    calloutDslConverted: 0,
  };

  // 0. Convert [!callout...]...[/callout] DSL → <callout>...</callout> XML
  const calloutDsl = convertCalloutDslToXml(mdText);
  mdText = calloutDsl.text;
  report.calloutDslConverted = calloutDsl.converted;

  // 0.1 Convert <add-ons> mermaid blocks → ```mermaid fences (must run before HTML stripping)
  const addOns = convertAddOnsToMermaid(mdText);
  mdText = addOns.text;
  report.addOnsMermaidConverted = addOns.converted;

  // 0.2 Apply Mermaid theming to any explicit mermaid fences in the document.
  const mermaidTheme = themeMermaidFences(mdText);
  mdText = mermaidTheme.text;
  report.mermaidThemeApplied = mermaidTheme.themed;

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
