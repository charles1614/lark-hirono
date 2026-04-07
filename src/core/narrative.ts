/**
 * Narrative document optimizer — content-level improvements for narrative docs.
 *
 * Handles deterministic transforms that don't require LLM:
 * - Code block language tag detection
 * - Opening callout injection (from first content paragraph)
 * - Blockquote → callout conversion for key phrases
 * - Bold signpost phrases for scannability
 *
 * LLM-assisted transforms (red/green emphasis):
 * - Extract candidate sentences → save to JSON
 * - User saves LLM results → apply from JSON
 *
 * Ported from skills/lark-hirono/references/optimization-guide.md rules.
 */

import { readFileSync, writeFileSync } from "node:fs";

// ─── Types ──────────────────────────────────────────────────────────────

export interface NarrativeAnalysis {
  codeBlocksWithoutLang: number;
  paragraphs: string[];
  headings: string[];
  hasOpeningCallout: boolean;
  blockquoteCount: number;
  tldrCount: number;
  signpostPhrasesFound: number;
}

export interface EmphasisCandidate {
  paragraphIndex: number;
  text: string;
  type: "red" | "green" | "bold-signpost";
  reason: string;
}

// ─── Deterministic Transforms ───────────────────────────────────────────

/** Detect and tag code blocks with language. */
export function tagCodeBlocks(md: string): { text: string; tagged: number } {
  // Patterns that match content AFTER the triple backtick newline
  const langPatterns: [string, RegExp][] = [
    // Python
    ["python", /\b(?:def |class |import |from \w+ import |self\.|print\(|pip install)/],
    // Bash/Shell (use RegExp constructor for #! patterns)
    ["bash", new RegExp("#!/usr/bin/env (?:ba)?sh|#!/bin/(?:ba)?sh|apt\\s+install|yum\\s+|systemctl |cd /etc|nginx -t|certbot")],
    // Nginx config
    ["nginx", /\b(?:listen |server_name\s+|upstream\s+|proxy_pass|location\s+\w|worker_|ssl_certificate)/],
    // YAML
    ["yaml", /^(?:version:\s*['"]?\d|services:\s*$|deploy:|build:|environment:\s*$)/m],
    // JSON
    ["json", /^\s*\{\s*"|\[\s*"/],
    // Go
    ["go", /\b(?:package main|func \w+|defer |fmt\.|http\.(?:ListenAndServe|Get))/],
    // TypeScript/JavaScript
    ["typescript", /\b(?:const \w+|let \w+|function \w+|export (?:const |default |function |interface )|console\.|import \{)/],
    // C/C++
    ["cpp", /\b(?:#include\s*<|int main\(|void \w+|std::|printf\(|#define\s)/],
    // Java
    ["java", /\b(?:public class |private \w+|public static void|@Override|extends |implements |package \w+\.\w)/],
    // Rust
    ["rust", /\b(?:pub fn \w+|fn main\(|let mut |impl \w+|use \w+;|async fn)/],
  ];

  let tagged = 0;
  const uselessTags = new Set(["plaintext", "text", "markdown", "md", "shell", "sh", "code", ""]);
  let result = md.replace(/```([a-zA-Z]*)\n([\s\S]*?)```/g, (match, existingTag, content) => {
    // Skip blocks with meaningful language tags
    if (existingTag && !uselessTags.has(existingTag.toLowerCase())) return match;

    // Check each language pattern
    for (const [lang, pattern] of langPatterns) {
      if (pattern.test(content)) {
        tagged++;
        return "```" + lang + "\n" + content + "```";
      }
    }

    return match;
  });

  return { text: result, tagged };
}

/** Check if doc has an opening callout. */
export function hasOpeningCallout(md: string): boolean {
  const lines = md.split("\n");
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    if (/<callout/.test(lines[i])) return true;
  }
  return false;
}

/** Strip LLM chatbot tail from end of fetched docs. */
export function stripChatbotTail(md: string): { text: string; stripped: boolean } {
  const tailPatterns = [
    /如果你想要[\s\S]*?Markdown 文件.*$/m,
    /如果你需要[\s\S]*?Markdown 文件.*$/m,
    /如果你想要[\s\S]*?保存供你直接.*$/m,
    /希望这份.*对你有.*$/m,
    /希望这份.*能帮到你.*$/m,
  ];

  let stripped = false;
  let result = md;
  for (const pattern of tailPatterns) {
    const newResult = result.replace(pattern, "").trimEnd();
    if (newResult.length < result.length) {
      result = newResult;
      stripped = true;
    }
  }
  return { text: result, stripped };
}

/** Convert leading blockquotes to callout format. */
export function convertBlockquotesToCallouts(md: string): { text: string; converted: number } {
  const tldrRe = />\s*TL;DR/i;
  const summaryRe = />\s*(?:核心思想|关键结论|一句话总结|一句话定位|核心区别|本质)/;
  const importantRe = />[^>]*\*\*(?:核心|关键|重要|注意|TL;DR|总结|一句话)/;

  let converted = 0;
  const lines = md.split("\n");
  const out: string[] = [];
  let inBlockquote = false;
  let bqLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith(">") && !line.includes("[!callout")) {
      inBlockquote = true;
      bqLines.push(line);
      continue;
    }

    if (inBlockquote) {
      const bqText = bqLines.join("\n").trim();

      if (tldrRe.test(bqText)) {
        const content = bqLines.map((l) => l.replace(/^>\s*/, "")).join("\n");
        out.push(
          ``,
          `<callout emoji="bulb" background-color="light-blue" border-color="light-blue">`,
          content,
          `</callout>`,
        );
        converted++;
      } else if (summaryRe.test(bqText)) {
        // Convert to green callout
        const content = bqLines.map((l) => l.replace(/^>\s*/, "")).join("\n");
        out.push(
          ``,
          `<callout emoji="pushpin" background-color="light-green" border-color="light-green">`,
          content,
          `</callout>`,
        );
        converted++;
      } else if (importantRe.test(bqText)) {
        // Convert to orange callout
        const content = bqLines.map((l) => l.replace(/^>\s*/, "")).join("\n");
        out.push(
          ``,
          `<callout emoji="warning" background-color="light-yellow" border-color="light-yellow">`,
          content,
          `</callout>`,
        );
        converted++;
      } else {
        // Keep as plain blockquote
        out.push(...bqLines);
      }

      inBlockquote = false;
      bqLines = [];
    }

    out.push(line);
  }

  // Handle trailing blockquote
  if (inBlockquote && bqLines.length > 0) {
    out.push(...bqLines);
  }

  return { text: out.join("\n"), converted };
}

/** Bold signpost phrases for scannability. */
export function boldSignpostPhrases(md: string): { text: string; bolded: number } {
  const signposts = [
    "在内存优化方面",
    "在计算效率方面",
    "在通信优化方面",
    "在扩展性方面",
    "在安全性方面",
    "在性能方面",
    "在稳定性方面",
    "在兼容性方面",
    "从工程角度",
    "从理论角度",
    "从架构角度",
    "具体来说",
    "值得注意的是",
    "核心区别在于",
    "本质上",
    "关于[^，]*的",
    "首先[^，]*，",
    "其次[^，]*，",
    "最后[^，。]*[，。]",
  ];

  let bolded = 0;
  let result = md;

  for (const phrase of signposts) {
    const regex = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    result = result.replace(regex, (match) => {
      bolded++;
      return `**${match}**`;
    });
  }

  return { text: result, bolded };
}

/** Add section separators before H2 headings. */
export function addSectionSeparators(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Add --- before ## headings (except at start of doc)
    if (line.startsWith("## ") && out.length > 0 && out[out.length - 1].trim() !== "---") {
      if (out[out.length - 1].trim() !== "") {
        out.push("", "---", "");
      }
    }
    out.push(line);
  }

  return out.join("\n");
}

/** Inject opening callout if missing. */
export function injectOpeningCallout(
  md: string,
  icon: string = "bookmark",
  description?: string
): { text: string; injected: boolean } {
  if (hasOpeningCallout(md)) return { text: md, injected: false };

  const lines = md.split("\n");
  const insertIdx = lines.findIndex((l) => l.match(/^#{1,2} /));

  if (insertIdx === -1) return { text: md, injected: false };

  // Extract description from first paragraph before first heading
  let desc = "";
  let descLineIdx = -1;
  if (description) {
    desc = description;
  } else {
    // Try to get first paragraph content
    for (let i = 0; i < insertIdx; i++) {
      const trimmed = lines[i].trim();
      if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---") && !trimmed.startsWith(">")) {
        desc = trimmed;
        descLineIdx = i;
        break;
      }
    }
  }

  const calloutLines = [
    "",
    `<callout emoji="${icon}" background-color="light-blue" border-color="light-blue">`,
    desc ? desc : "本文档概述。",
    `</callout>`,
    "",
    "",
  ];

  const newLines = [...lines];

  // Remove the original paragraph line if we extracted it
  if (descLineIdx >= 0) {
    newLines.splice(descLineIdx, 1);
    // Adjust insertIdx if we removed a line before it
    const adjustedInsertIdx = descLineIdx < insertIdx ? insertIdx - 1 : insertIdx;
    newLines.splice(adjustedInsertIdx, 0, ...calloutLines);
  } else {
    newLines.splice(insertIdx, 0, ...calloutLines);
  }

  return { text: newLines.join("\n"), injected: true };
}

/** Analyze a narrative document for optimization opportunities. */
export function analyzeNarrativeDoc(md: string): NarrativeAnalysis {
  const lines = md.split("\n");
  const paragraphs: string[] = [];
  const headings: string[] = [];
  let codeBlocksWithoutLang = 0;
  let inCodeBlock = false;
  let blockquoteCount = 0;
  let tldrCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        // Check if language tag is present
        const tagMatch = trimmed.match(/```(\w+)/);
        if (!tagMatch) codeBlocksWithoutLang++;
      }
      continue;
    }

    if (inCodeBlock) continue;

    if (trimmed.match(/^#{1,6} /)) {
      headings.push(trimmed);
      continue;
    }

    if (trimmed.startsWith(">")) {
      blockquoteCount++;
      if (/TL;DR/i.test(trimmed)) tldrCount++;
      continue;
    }

    if (trimmed) paragraphs.push(trimmed);
  }

  return {
    codeBlocksWithoutLang,
    paragraphs,
    headings,
    hasOpeningCallout: hasOpeningCallout(md),
    blockquoteCount,
    tldrCount,
    signpostPhrasesFound: 0, // Computed during actual transform
  };
}

/** Extract emphasis candidates for LLM keyword selection. */
export function extractEmphasisCandidates(md: string): EmphasisCandidate[][] {
  const paragraphs = md.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("```") && !l.startsWith(">"));

  // Simple heuristic: key sentences are those with conclusions, results, or important claims
  const candidatePatterns = [
    { regex: /[于是因此所以](?:.*?)(?:降低|提升|优化|改善|减少|增加|实现|完成|突破|超越|优于|胜过)。?$/, type: "red" as const, reason: "conclusion/result" },
    { regex: /[。！？](?:.*?)(?:降低|提升|优化|改善|减少|增加|实现|完成|突破|超越|优于|胜过)。?$/, type: "red" as const, reason: "conclusion/result" },
    { regex: /(?:架构|设计|方案|原理|机制|算法|模型|方案|模式).{5,30}核心|关键|重要|主要/, type: "green" as const, reason: "key concept" },
  ];

  const batches: EmphasisCandidate[][] = [[]];

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];

    for (const { regex, type, reason } of candidatePatterns) {
      if (regex.test(para)) {
        if (batches[batches.length - 1].length >= 50) {
          batches.push([]);
        }
        batches[batches.length - 1].push({
          paragraphIndex: i,
          text: para.slice(0, 200),
          type,
          reason,
        });
        break;
      }
    }
  }

  return batches;
}

/** Save emphasis candidate batches to JSON. */
export function saveEmphasisBatches(
  batches: EmphasisCandidate[][],
  inputPath: string
): string[] {
  const paths: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const filePath = `${inputPath}.emphasis_batch_${i}.json`;
    writeFileSync(filePath, JSON.stringify(batches[i], null, 2), "utf-8");
    paths.push(filePath);
  }
  return paths;
}

/** Apply emphasis from LLM results. */
export function applyEmphasis(md: string, selections: { index: number; emphasis: string }[]): string {
  let lines = md.split("\n");
  let applied = 0;

  for (const selection of selections) {
    const para = lines[selection.index];
    if (!para) continue;

    // Replace with user-selected emphasis
    lines[selection.index] = selection.emphasis;
    applied++;
  }

  return lines.join("\n");
}

// ─── Full Narrative Optimize ─────────────────────────────────────────────

export interface NarrativeOptimizeOptions {
  calloutIcon?: string;
  calloutDescription?: string;
  convertBlockquotes?: boolean;
  boldSignposts?: boolean;
  sectionSeparators?: boolean;
  tagCode?: boolean;
}

export interface NarrativeOptimizeResult {
  text: string;
  stats: {
    calloutInjected: boolean;
    blockquotesConverted: number;
    signpostsBolded: number;
    separatorsAdded: number;
    codeBlocksTagged: number;
  };
}

/**
 * Apply all deterministic narrative optimizations.
 */
export function optimizeNarrative(
  md: string,
  opts: NarrativeOptimizeOptions = {}
): NarrativeOptimizeResult {
  const {
    calloutIcon = "bulb",
    calloutDescription,
    convertBlockquotes = true,
    boldSignposts = true,
    sectionSeparators = false,
    tagCode = true,
  } = opts;

  let text = md;
  const stats = {
    calloutInjected: false,
    blockquotesConverted: 0,
    signpostsBolded: 0,
    separatorsAdded: 0,
    codeBlocksTagged: 0,
  };

  // 1. Code block language tags
  if (tagCode) {
    const { text: tagged, tagged: count } = tagCodeBlocks(text);
    text = tagged;
    stats.codeBlocksTagged = count;
  }

  // 2. Opening callout
  if (!hasOpeningCallout(text)) {
    const result = injectOpeningCallout(text, calloutIcon, calloutDescription);
    text = result.text;
    stats.calloutInjected = result.injected;
  }

  // 3. Blockquote → callout
  if (convertBlockquotes) {
    const { text: converted, converted: count } = convertBlockquotesToCallouts(text);
    text = converted;
    stats.blockquotesConverted = count;
  }

  // 4. Bold signpost phrases
  if (boldSignposts) {
    const { text: bolded, bolded: count } = boldSignpostPhrases(text);
    text = bolded;
    stats.signpostsBolded = count;
  }

  // 5. Section separators
  if (sectionSeparators) {
    const before = text.split("\n").filter((l) => l.trim() === "---").length;
    text = addSectionSeparators(text);
    const after = text.split("\n").filter((l) => l.trim() === "---").length;
    stats.separatorsAdded = after - before;
  }

  return { text, stats };
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: narrative.ts <input.md> <output.md> [--analyze|--extract-emphasis]");
    process.exit(1);
  }

  const inputPath = args[0];
  const text = readFileSync(inputPath, "utf-8");

  if (args.includes("--analyze")) {
    const analysis = analyzeNarrativeDoc(text);
    console.log(JSON.stringify(analysis, null, 2));
  } else if (args.includes("--extract-emphasis")) {
    const batches = extractEmphasisCandidates(text);
    const paths = saveEmphasisBatches(batches, inputPath);
    const total = batches.reduce((n, b) => n + b.length, 0);
    console.log(`Total: ${total} candidates in ${batches.length} batch(es)`);
    for (let i = 0; i < batches.length; i++) {
      console.log(`Batch ${i}: ${batches[i].length} candidates → ${paths[i]}`);
    }
  } else {
    const outputPath = args[1];
    const result = optimizeNarrative(text);
    writeFileSync(outputPath, result.text, "utf-8");
    console.log(`Optimized: ${JSON.stringify(result.stats)}`);
    console.log(`Output: ${outputPath}`);
  }
}

if (process.argv[1]?.endsWith("narrative.ts")) {
  main();
}