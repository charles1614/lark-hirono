/**
 * Markdown preprocess — deterministic transforms for Feishu doc creation.
 *
 * Handles:
 * - Blue numbering prefix on numbered headings
 * - Heading background color via block-level PATCH (not in this module)
 * - Rainbow color mapping per heading level
 * - Inline text color/bg via Lark-flavored markdown
 */

import { readFileSync, writeFileSync } from "node:fs";

// ─── Types ──────────────────────────────────────────────────────────────

export interface RainbowConfig {
  /** Number prefix color */
  numberColor: string;
  /** Background color name for <text bgcolor="..."> */
  bgColor: string;
}

export interface PreprocessOptions {
  /** Rainbow color map per heading level (2=##, 3=###, etc.) */
  rainbowMap?: Record<number, RainbowConfig>;
  /** Strip first H1 if it duplicates the document title */
  stripTitle?: boolean;
  /** Number prefix color (used when no rainbow map) */
  numberColor?: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_RAINBOW: Record<number, RainbowConfig> = {
  2: { numberColor: "blue", bgColor: "light-orange" },
  3: { numberColor: "blue", bgColor: "light-yellow" },
  4: { numberColor: "blue", bgColor: "light-green" },
  5: { numberColor: "blue", bgColor: "light-blue" },
  6: { numberColor: "blue", bgColor: "light-yellow" },
};

// ─── Regex ──────────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,9})\s+(.*)$/;
// Matches: 1. Title | 1.1 Background | 1.1.1 Scope | 2) Title
const NUMBER_PREFIX_RE = /^(?<num>\d+(?:\.\d+)*(?:\.|\))?)\s+(?<title>.+?)\s*$/;
// Detects already-decorated headings
const TEXT_TAG_RE = /^<text\s+[^>]+>/i;
// Matches {color="..."} heading attributes
const HEADING_BG_ATTR_RE = /\s*\{color="[^"]*(?:Background)?"(?:\s+align="[^"]*")?\}/gi;

// ─── Core ───────────────────────────────────────────────────────────────

/**
 * Transform a single heading line.
 * - Plain numbered heading → blue prefix + optional rainbow bg
 * - Already decorated → pass through
 * - No number → bg only
 */
export function transformHeading(
  line: string,
  rainbowMap: Record<number, RainbowConfig> = DEFAULT_RAINBOW
): string {
  const m = HEADING_RE.exec(line);
  if (!m) return line;

  const [, hashes, rawContent] = m;
  const content = rawContent.trimEnd();

  // Already has <text> tag — leave unchanged
  if (TEXT_TAG_RE.test(content)) return line;

  const level = hashes.length;
  const colors =
    rainbowMap[level] ?? rainbowMap[2] ?? { numberColor: "blue", bgColor: "light-orange" };

  // Remove old {color=...} heading attributes
  const clean = content.replace(HEADING_BG_ATTR_RE, "").trim();

  const nm = NUMBER_PREFIX_RE.exec(clean);
  if (!nm?.groups) {
    // No number — just pass through, block-level bg handled by PATCH
    return `${hashes} ${clean}`;
  }

  let number = nm.groups.num;
  const title = nm.groups.title;

  // Normalize: "1" → "1.", "1." → "1" (strip trailing dot for multi-level)
  if (!number.includes(".") && /\d$/.test(number)) {
    number = number + ".";
  } else if (number.endsWith(".")) {
    number = number.slice(0, -1);
  }

  // Blue number prefix only — block-level bg handled by PATCH
  return `${hashes} <text color="${colors.numberColor}">${number} </text>${title}`;
}

/**
 * Preprocess full markdown text.
 */
export function preprocessMarkdown(
  text: string,
  opts: PreprocessOptions = {}
): string {
  const rainbowMap = opts.rainbowMap ?? DEFAULT_RAINBOW;
  let lines = text.split("\n");

  // Optionally strip first H1
  if (opts.stripTitle && lines[0]?.startsWith("# ")) {
    lines = lines.slice(1);
    if (lines[0] === "") lines = lines.slice(1);
  }

  // Track H2 heading counter for sequential blue numbering
  let h2Counter = 0;
  const out = lines.map((line) => {
    const transformed = transformHeading(line, rainbowMap);
    // If this is an H2 heading that didn't get a number prefix, add sequential number
    if (/^## (?!<text)/.test(transformed.trim())) {
      h2Counter++;
      const colors = rainbowMap[2] ?? { numberColor: "blue", bgColor: "light-orange" };
      return transformed.replace(/^(## )(.+)/, `$1<text color="${colors.numberColor}">${h2Counter} </text>$2`);
    }
    return transformed;
  });
  const trailing = text.endsWith("\n") ? "\n" : "";
  let result = out.join("\n") + trailing;

  // Normalize bold integer bg colors to light variants
  result = result.replaceAll('bgcolor="green"', 'bgcolor="light-green"');
  result = result.replaceAll('bgcolor="blue"', 'bgcolor="light-blue"');
  result = result.replaceAll('bgcolor="orange"', 'bgcolor="light-orange"');
  result = result.replaceAll('bgcolor="yellow"', 'bgcolor="light-yellow"');
  result = result.replaceAll('bgcolor="red"', 'bgcolor="light-red"');
  // Also handle background-color attribute name
  result = result.replaceAll('background-color="green"', 'background-color="light-green"');
  result = result.replaceAll('background-color="blue"', 'background-color="light-blue"');
  result = result.replaceAll('background-color="orange"', 'background-color="light-orange"');
  result = result.replaceAll('background-color="yellow"', 'background-color="light-yellow"');
  result = result.replaceAll('background-color="red"', 'background-color="light-red"');

  return result;
}

// ─── CLI ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // stdin mode
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => {
      process.stdout.write(preprocessMarkdown(Buffer.concat(chunks).toString("utf-8")));
    });
    return;
  }

  const inputPath = args[0];
  const outputPath = args[1] ?? null;
  const text = readFileSync(inputPath, "utf-8");
  const result = preprocessMarkdown(text);

  if (outputPath) {
    writeFileSync(outputPath, result, "utf-8");
  } else {
    process.stdout.write(result);
  }
}

if (process.argv[1]?.endsWith("preprocess.ts")) {
  main();
}
