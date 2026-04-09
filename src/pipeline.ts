/**
 * Pipeline — main orchestration: analyze → normalize → narrative-optimize → preprocess → create → patch → verify.
 */

import { readFileSync } from "node:fs";
import { LarkCli } from "./cli.js";
import { analyzeMarkdown } from "./core/analyze.js";
import { normalizeMarkdown, lintMarkdown, boldTableHeaders, unescapePipes } from "./core/normalize.js";
import { highlightExtract, saveBatches, highlightApply, type KeywordEntry } from "./core/highlight.js";
import { preprocessMarkdown } from "./core/preprocess.js";
import { computePatches, executePatches, cleanupEmptyTails } from "./patch/patch.js";
import { extractMermaidBlocks, patchMermaidWhiteboards } from "./whiteboard/mermaid-patch.js";
import { processImages, extractImageRefs } from "./image/images.js";
import { splitMarkdown } from "./core/chunked.js";
import { convertToLarkTables } from "./core/lark-table.js";
import { verifyDoc, formatReport } from "./verify/verify.js";
import { log, logError, initLogging } from "./logging.js";
import { optimizeNarrative, stripChatbotTail } from "./core/narrative.js";

// ─── Arg Parsing ────────────────────────────────────────────────────────

export interface PipelineArgs {
  input: string;
  title: string;
  wikiSpace: string;
  wikiNode: string;
  imageDir: string | null;
  stripTitle: boolean;
  bgMode: "light" | "dark";
  highlight: boolean;
  verify: boolean;
  analyzeOnly: boolean;
  dryRun: boolean;
  verbose: boolean;
  // Optimize workflow support
  mode?: "create" | "update";
  docId?: string;
  fetch?: boolean;
  createNew?: boolean;       // --new: create sibling doc
  sourceDocId?: string;      // original doc ID (used for --new to fetch)
}

export interface PipelineResult {
  ok: boolean;
  docId?: string;
  docUrl?: string;
  verifyReport?: ReturnType<typeof formatReport>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Section Split ──────────────────────────────────────────────────────

const SECTION_LIMIT = 40_000;
const CHUNK_ROWS = 50;

function splitOversizedSections(md: string): string {
  const lines = md.split("\n");
  const sections: { heading: string; rows: string[] }[] = [];
  let current = { heading: "", rows: [] as string[] };

  for (const line of lines) {
    if (/^## /.test(line.trim())) {
      if (current.heading || current.rows.length > 0) sections.push(current);
      current = { heading: line, rows: [] };
    } else {
      current.rows.push(line);
    }
  }
  if (current.heading || current.rows.length > 0) sections.push(current);

  const out: string[] = [];
  for (const sec of sections) {
    const secText = sec.heading + "\n" + sec.rows.join("\n");
    if (Buffer.byteLength(secText, "utf-8") <= SECTION_LIMIT) {
      out.push(sec.heading, ...sec.rows);
      continue;
    }
    const headerIdx = sec.rows.findIndex((l) => /^\|[-:| ]+\|$/.test(l.trim()));
    if (headerIdx < 1) {
      out.push(sec.heading, ...sec.rows);
      continue;
    }
    const preamble = sec.rows.slice(0, headerIdx + 1);
    const dataRows = sec.rows.slice(headerIdx + 1);
    const totalChunks = Math.ceil(dataRows.length / CHUNK_ROWS);
    // Extract parent number from heading (e.g., "4" from "<text color="blue">4 </text>")
    const parentNumMatch = sec.heading.match(/<text[^>]*>(\d+)\s*<\/text>/);
    const parentNum = parentNumMatch?.[1] ?? "";
    // Emit parent heading only when there are 2+ chunks
    if (totalChunks > 1) {
      out.push(sec.heading);
    }
    let subCounter = 0;
    for (let i = 0; i < dataRows.length; i += CHUNK_ROWS) {
      const chunk = dataRows.slice(i, i + CHUNK_ROWS);
      let subHeading: string;
      if (totalChunks > 1) {
        subCounter++;
        const rangeStr = `[${i + 1}-${Math.min(i + CHUNK_ROWS, dataRows.length)}]`;
        // Replace ## with ### and append hierarchical sub-number (e.g., 4.1)
        subHeading = sec.heading.replace(
          /^## (.+?)(\s+\{.*\})?$/,
          `### $1 ${rangeStr}$2`
        );
        // Replace parent number with hierarchical number (e.g., "4" → "4.1")
        if (parentNum) {
          subHeading = subHeading.replace(
            new RegExp(`>${parentNum}\\s*<\\/text>`),
            `>${parentNum}.${subCounter} </text>`
          );
        }
      } else {
        // Single chunk but oversized: keep as ## (no parent needed)
        subHeading = sec.heading;
      }
      out.push(subHeading, ...preamble, ...chunk);
    }
  }
  return out.join("\n");
}

// ─── Pipeline ───────────────────────────────────────────────────────────

export async function runPipeline(args: PipelineArgs): Promise<PipelineResult> {
  initLogging(args.verbose);
  const mode = args.mode ?? "create";

  // 1. Read source or fetch from Feishu
  let src: string;
  const fetchDocId = args.sourceDocId ?? args.docId;
  if (mode === "update" && args.fetch && args.docId) {
    const cli = new LarkCli({ retries: 3 });
    const fetched = cli.fetchDoc(args.docId);
    if (!fetched) {
      logError("Failed to fetch document from Feishu");
      process.exit(1);
    }
    const { text: cleaned, stripped } = stripChatbotTail(fetched);
    src = cleaned;
    log(`Fetched doc ${args.docId}: ${src.split("\n").length} lines${stripped ? " (chatbot tail stripped)" : ""}`);
  } else if (args.createNew && fetchDocId) {
    const cli = new LarkCli({ retries: 3 });
    const fetched = cli.fetchDoc(fetchDocId);
    if (!fetched) {
      logError("Failed to fetch source document from Feishu");
      process.exit(1);
    }
    const { text: cleaned, stripped } = stripChatbotTail(fetched);
    src = cleaned;
    log(`Fetched source doc ${fetchDocId}: ${src.split("\n").length} lines${stripped ? " (chatbot tail stripped)" : ""}`);
  } else if (args.input) {
    src = readFileSync(args.input, "utf-8");
  } else {
    logError("Missing input: provide --input file or --doc with --fetch");
    process.exit(1);
  }

  let title = args.title;
  if (!title && mode === "create") {
    const h1Match = src.match(/^#\s+(.+)$/m);
    if (h1Match) {
      const base = h1Match[1].replace(/\s*\{.*\}/, "").trim();
      title = args.createNew ? `${base} (optimized)` : base;
    }
  } else if (!title && mode === "update") {
    // Extract title from fetched doc for logging
    const h1Match = src.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].replace(/\s*\{.*\}/, "").trim();
  }
  if (args.createNew) title = title || "optimized";
  log(`Title: ${title}`);

  // 2. Normalize (HTML → markdown)
  const { text: normalized, report: normReport } = normalizeMarkdown(src);
  log(`Normalized: table_sep=${normReport.tableSeparatorFixed}`);

  // 3. Analyze document type
  const analysis = analyzeMarkdown(normalized);
  if (args.verbose || args.analyzeOnly) {
    console.log(JSON.stringify({
      document_type: analysis.documentType,
      tables: `${analysis.tableCount}/${analysis.tableRows} rows`,
      headings: analysis.headingCount,
    }, null, 2));
  }
  if (args.analyzeOnly) return { ok: true };

  // 2.5. Narrative document optimization (non-table docs)
  let narrativeMd = normalized;
  if (analysis.documentType === "narrative") {
    const result = optimizeNarrative(normalized, { calloutIcon: "bulb" });
    narrativeMd = result.text;
    if (result.stats.calloutInjected) log(`Narrative: opening callout injected`);
    if (result.stats.codeBlocksTagged > 0) log(`Narrative: ${result.stats.codeBlocksTagged} code blocks tagged`);
    if (result.stats.blockquotesConverted > 0) log(`Narrative: ${result.stats.blockquotesConverted} blockquotes → callouts`);
    if (result.stats.signpostsBolded > 0) log(`Narrative: ${result.stats.signpostsBolded} signpost phrases bolded`);
    if (result.stats.separatorsAdded > 0) log(`Narrative: ${result.stats.separatorsAdded} section separators added`);
  }

  // 4. Lint
  const warnings = lintMarkdown(narrativeMd);
  if (warnings.length > 0 && args.verbose) {
    for (const w of warnings) log(`⚠ ${w}`);
  }

  // 5. Preprocess (heading numbers already normalized in step 2)
  let md = preprocessMarkdown(narrativeMd, { stripTitle: args.stripTitle });
  md = splitOversizedSections(md);
  log(`After section split: ${md.split("\n").length} lines`);

  // 6. Highlight (MUST run before convertToLarkTables — works on markdown tables only)
  const kwPathBase = args.input || args.docId || "doc";
  const highlightKeywordFile = kwPathBase + ".selected_keywords.json";
  let hasKeywordFile = false;
  try { readFileSync(highlightKeywordFile); hasKeywordFile = true; } catch { /* no file */ }

  if (args.highlight && analysis.documentType === "catalog_table") {
    const batches = highlightExtract(md);
    const totalTitles = batches.reduce((n, b) => n + b.length, 0);
    log(`Highlight: ${totalTitles} titles in ${batches.length} batch(es)`);

    if (hasKeywordFile) {
      const keywords: KeywordEntry[] = JSON.parse(readFileSync(highlightKeywordFile, "utf-8"));
      log(`Highlight: loading ${keywords.length} keywords`);
      const { markdown: highlighted } = highlightApply(md, keywords);
      md = highlighted;
      log(`Highlight: applied keywords`);
    } else {
      const batchPaths = saveBatches(batches, kwPathBase);
      log(`Highlight: saved ${batchPaths.length} batch file(s) for LLM selection`);
      if (mode === "create") {
        log(`Highlight: waiting for ${highlightKeywordFile}`);
      }
    }
  }

  // Convert {color:content} → <text color="color">content</text>
  // Handles {red:**bold**}, {green:`code`}, {red:plain}, etc.
  // This runs regardless of --no-highlight so fixture tags always render.
  // Skip code fences to avoid corrupting mermaid %%{init:...}%% directives.
  md = md.split(/(```[\s\S]*?```)/g).map((block) =>
    block.startsWith("```") ? block : block.replace(/\{(\w+):([^}]+)\}/g, '<text color="$1">$2</text>')
  ).join("");
  const redCount = (md.match(/<text color="red">/g) || []).length;
  if (redCount > 0) log(`Red highlights: ${redCount}`);

  // 7. Convert markdown tables to lark-table XML
  md = boldTableHeaders(md);
  md = convertToLarkTables(md);
  md = unescapePipes(md); // unescape \| in lark-table cells
  log(`After lark-table: ${md.split("\n").length} lines`);

  if (args.dryRun) { process.stdout.write(md); return { ok: true }; }

  // 8. Init CLI
  const cli = new LarkCli({ retries: 3 });
  try { cli.status(); } catch (err) { logError(`Auth error: ${(err as Error).message}`); process.exit(1); }

  // 9. Create or update document
  const MAX_BYTES = 200_000;
  const mdBytes = Buffer.byteLength(md, "utf-8");
  log(`Markdown size: ${Math.round(mdBytes / 1024)} KB`);

  let docId: string;
  let docUrl: string;
  let boardTokens: string[] = [];
  const mermaidBlocks = extractMermaidBlocks(md);
  if (mermaidBlocks.length > 0) log(`Mermaid blocks: ${mermaidBlocks.length}`);

  // --new always creates a new doc, never overwrites
  if (mode === "update" && args.docId && !args.createNew) {
    log(`Updating document ${args.docId}...`);
    const updated = cli.updateDoc(args.docId, md);
    if (!updated.ok) { logError("ERROR: Document update failed"); process.exit(1); }
    docId = args.docId;
    docUrl = `https://www.feishu.cn/wiki/${docId}`;
    boardTokens = updated.boardTokens;
    log("Update complete");
  } else {
    log("Creating document...");
    if (mdBytes <= MAX_BYTES) {
      const created = cli.createDoc(title, md, args.wikiSpace, args.wikiNode);
      if (!created) { logError("ERROR: Document creation failed"); process.exit(1); }
      docId = created.doc_id;
      docUrl = created.url;
      boardTokens = created.boardTokens;
    } else {
      log("Large doc, using chunked upload...");
      const chunks = splitMarkdown(md, { maxLines: 200, maxBytes: MAX_BYTES });
      log(`Split into ${chunks.length} chunks`);

      const created = cli.createDoc(title, chunks[0].markdown, args.wikiSpace, args.wikiNode);
      if (!created) { logError("ERROR: Document creation failed"); process.exit(1); }
      docId = created.doc_id;
      docUrl = created.url;
      log(`Created chunk 0/${chunks.length - 1}: ${docId}`);

      let lastHeading = "";
      const headingFromChunk = (m: string): string =>
        m.match(/^(#{1,6}\s+.+)$/m)?.[1] ?? "";
      lastHeading = headingFromChunk(chunks[0].markdown);

      for (let i = 1; i < chunks.length; i++) {
        let chunkMd = chunks[i].markdown;
        const currentHeading = headingFromChunk(chunkMd);
        if (currentHeading) { lastHeading = currentHeading; }
        else if (lastHeading) { chunkMd = lastHeading + "\n\n" + chunkMd; }

        if (!cli.appendDoc(docId, chunkMd)) {
          log(`WARNING: Chunk ${i}/${chunks.length - 1} append returned failure (may still have been uploaded)`);
        }
        await sleep(2000);
        log(`Appended chunk ${i}/${chunks.length - 1}`);
      }
    }
  }

  log(`Doc ready: ${docId}`);

  // 10. Images
  const imageRefs = extractImageRefs(md);
  if (imageRefs.length > 0) {
    log(`Images: ${imageRefs.length} references found`);
    try {
      const imgResult = processImages(cli, md, docId);
      log(`Images: ${imgResult.uploaded}/${imageRefs.length} uploaded`);
    } catch (err) { log(`Image error: ${(err as Error).message}`); }
  }

  // 11. Patches (heading backgrounds)
  const blocks = cli.getBlocks(docId);
  log(`Blocks: ${blocks.length}`);
  const patches = computePatches(blocks, args.bgMode);
  log(`Patches: ${patches.length}`);
  if (patches.length > 0) {
    const [ok, total] = executePatches(cli, docId, patches);
    log(`Patch result: ${ok}/${total}`);
  }

  // 11b. Clean up Feishu auto-created trailing empty blocks inside containers
  const cleaned = cleanupEmptyTails(cli, docId, blocks);
  if (cleaned > 0) log(`Cleanup: removed ${cleaned} trailing empty block(s)`);

  // 11c. Patch mermaid whiteboard connector caption background colors
  if (mermaidBlocks.length > 0 && boardTokens.length > 0) {
    const patched = patchMermaidWhiteboards(boardTokens, mermaidBlocks, cli);
    log(`Whiteboard patch: ${patched}/${boardTokens.length} boards`);
  }

  // 12. Verify
  let verifyReport: string | undefined;
  if (args.verify) {
    const report = verifyDoc(cli, docId, { hasTables: analysis.documentType === "narrative" ? false : true, documentType: analysis.documentType });
    verifyReport = formatReport(report);
    console.log(verifyReport);
  }

  console.log(`\nDone. URL: ${docUrl}`);
  return { ok: true, docId, docUrl, verifyReport };
}

// CLI entry (only when run directly, not imported)
if (process.argv[1]?.endsWith("pipeline.ts") || process.argv[1]?.endsWith("pipeline.js")) {
  const args: PipelineArgs = {
    input: process.argv[2] || "",
    title: process.argv[3] || "",
    wikiSpace: "7620053427331681234",
    wikiNode: "UNtHwabqNiqc8ZkzvLscWNnwnYd",
    imageDir: null,
    stripTitle: false,
    bgMode: "light",
    highlight: true,
    verify: false,
    analyzeOnly: false,
    dryRun: false,
    verbose: false,
  };

  const rawArgs = process.argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["dry-run", "verify", "verbose", "strip-title", "analyze", "no-highlight"].includes(key)) {
        flags[key] = true;
      } else {
        flags[key] = rawArgs[++i] ?? "";
      }
    } else if (a === "-v") {
      flags.verbose = true;
    } else {
      positional.push(a);
    }
  }

  if (positional.length < 1) {
    console.error("Usage: pipeline.ts <input.md> [title] [--options]");
    process.exit(1);
  }

  args.input = positional[0];
  args.title = positional[1] ?? "";
  args.wikiSpace = (flags["wiki-space"] as string) || args.wikiSpace;
  args.wikiNode = (flags["wiki-node"] as string) || args.wikiNode;
  args.imageDir = (flags["image-dir"] as string) || null;
  args.stripTitle = Boolean(flags["strip-title"]);
  args.bgMode = (flags["bg-mode"] as "light" | "dark") || args.bgMode;
  args.highlight = !flags["no-highlight"];
  args.verify = Boolean(flags.verify);
  args.analyzeOnly = Boolean(flags.analyze);
  args.dryRun = Boolean(flags["dry-run"]);
  args.verbose = Boolean(flags.verbose);

  runPipeline(args).then(r => { if (!r.ok) process.exit(1); });
}
