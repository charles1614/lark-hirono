/**
 * Pipeline — main orchestration: analyze → normalize → preprocess → create → patch → verify.
 */

import { readFileSync } from "node:fs";
import { LarkCli } from "./cli.js";
import { analyzeMarkdown } from "./analyze.js";
import { normalizeMarkdown, lintMarkdown, boldTableHeaders, unescapePipes } from "./normalize.js";
import { highlightExtract, saveBatches, highlightApply, type KeywordEntry } from "./highlight.js";
import { preprocessMarkdown } from "./preprocess.js";
import { computePatches, executePatches } from "./patch.js";
import { processImages, extractImageRefs } from "./images.js";
import { splitMarkdown } from "./chunked.js";
import { convertToLarkTables } from "./lark-table.js";
import { verifyDoc, formatReport } from "./verify.js";

// ─── Arg Parsing ────────────────────────────────────────────────────────

interface PipelineArgs {
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
}

function parseArgs(argv: string[]): PipelineArgs {
  const args = argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["dry-run", "verify", "verbose", "strip-title", "analyze", "no-highlight"].includes(key)) {
        flags[key] = true;
      } else {
        flags[key] = args[++i] ?? "";
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

  return {
    input: positional[0],
    title: positional[1] || "",
    wikiSpace: (flags["wiki-space"] as string) || "7620053427331681234",
    wikiNode: (flags["wiki-node"] as string) || "UNtHwabqNiqc8ZkzvLscWNnwnYd",
    imageDir: (flags["image-dir"] as string) || null,
    stripTitle: Boolean(flags["strip-title"]),
    bgMode: (flags["bg-mode"] as "light" | "dark") || "light",
    highlight: !flags["no-highlight"],
    verify: Boolean(flags.verify),
    analyzeOnly: Boolean(flags.analyze),
    dryRun: Boolean(flags["dry-run"]),
    verbose: Boolean(flags.verbose),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function log(verbose: boolean, msg: string) {
  if (verbose) console.error(msg);
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
    for (let i = 0; i < dataRows.length; i += CHUNK_ROWS) {
      const chunk = dataRows.slice(i, i + CHUNK_ROWS);
      let heading = sec.heading;
      if (totalChunks > 1) {
        heading = sec.heading.replace(
          /^(## .+?)(\s+\{.*\})?$/,
          `$1 [${i + 1}-${Math.min(i + CHUNK_ROWS, dataRows.length)}]$2`
        );
      }
      out.push(heading, ...preamble, ...chunk);
    }
  }
  return out.join("\n");
}

// ─── Pipeline ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  // 1. Read source and extract title
  const src = readFileSync(args.input, "utf-8");

  let title = args.title;
  if (!process.argv.some((a) => a === "--title" || a === "-t")) {
    const h1Match = src.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].replace(/\s*\{.*\}/, "").trim();
  }
  log(args.verbose, `Title: ${title}`);

  // 2. Normalize (HTML → markdown)
  const { text: normalized, report: normReport } = normalizeMarkdown(src);
  log(args.verbose, `Normalized: table_sep=${normReport.tableSeparatorFixed}`);

  // 3. Analyze
  const analysis = analyzeMarkdown(normalized);
  if (args.verbose || args.analyzeOnly) {
    console.log(JSON.stringify({
      document_type: analysis.documentType,
      tables: `${analysis.tableCount}/${analysis.tableRows} rows`,
      headings: analysis.headingCount,
    }, null, 2));
  }
  if (args.analyzeOnly) return;

  // 4. Lint
  const warnings = lintMarkdown(normalized);
  if (warnings.length > 0 && args.verbose) {
    for (const w of warnings) log(true, `⚠ ${w}`);
  }

  // 5. Preprocess (heading numbers already normalized in step 2)
  let md = preprocessMarkdown(normalized, { stripTitle: args.stripTitle });
  md = splitOversizedSections(md);
  log(args.verbose, `After section split: ${md.split("\n").length} lines`);

  // 6. Highlight (MUST run before convertToLarkTables — works on markdown tables only)
  const highlightKeywordFile = args.input + ".selected_keywords.json";
  let hasKeywordFile = false;
  try { readFileSync(highlightKeywordFile); hasKeywordFile = true; } catch { /* no file */ }

  if (args.highlight && analysis.documentType === "catalog_table") {
    const batches = highlightExtract(md);
    const totalTitles = batches.reduce((n, b) => n + b.length, 0);
    log(args.verbose, `Highlight: ${totalTitles} titles in ${batches.length} batch(es)`);

    if (hasKeywordFile) {
      const keywords: KeywordEntry[] = JSON.parse(readFileSync(highlightKeywordFile, "utf-8"));
      log(args.verbose, `Highlight: loading ${keywords.length} keywords`);
      const { markdown: highlighted } = highlightApply(md, keywords);
      md = highlighted;
      log(args.verbose, `Highlight: applied keywords`);
    } else {
      const batchPaths = saveBatches(batches, args.input);
      log(args.verbose, `Highlight: saved ${batchPaths.length} batch file(s) for LLM selection`);
      log(args.verbose, `Highlight: waiting for ${highlightKeywordFile}`);
    }
  }

  // Convert {red:**keyword**} → <text color="red">keyword</text>
  // This runs regardless of --no-highlight so fixture tags always render.
  md = md.replace(/\{red:\*\*([^*]+)\*\*\}/g, '<text color="red">$1</text>');
  const redCount = (md.match(/<text color="red">/g) || []).length;
  if (redCount > 0) log(args.verbose, `Red highlights: ${redCount}`);

  // 7. Convert markdown tables to lark-table XML
  md = boldTableHeaders(md);
  md = convertToLarkTables(md);
  md = unescapePipes(md); // unescape \| in lark-table cells
  log(args.verbose, `After lark-table: ${md.split("\n").length} lines`);

  if (args.dryRun) { process.stdout.write(md); return; }

  // 8. Init CLI
  const cli = new LarkCli({ retries: 3 });
  try { cli.status(); } catch (err) { console.error(`Auth error: ${(err as Error).message}`); process.exit(1); }

  // 9. Create document
  log(args.verbose, "Creating document...");
  const MAX_BYTES = 50_000;
  const mdBytes = Buffer.byteLength(md, "utf-8");
  log(args.verbose, `Markdown size: ${Math.round(mdBytes / 1024)} KB`);

  let docId: string;
  let docUrl: string;

  if (mdBytes <= MAX_BYTES) {
    const created = cli.createDoc(title, md, args.wikiSpace, args.wikiNode);
    if (!created) { console.error("ERROR: Document creation failed"); process.exit(1); }
    docId = created.doc_id;
    docUrl = created.url;
  } else {
    log(args.verbose, "Large doc, using chunked upload...");
    const chunks = splitMarkdown(md, { maxLines: 200, maxBytes: MAX_BYTES });
    log(args.verbose, `Split into ${chunks.length} chunks`);

    const created = cli.createDoc(title, chunks[0].markdown, args.wikiSpace, args.wikiNode);
    if (!created) { console.error("ERROR: Document creation failed"); process.exit(1); }
    docId = created.doc_id;
    docUrl = created.url;
    log(args.verbose, `Created chunk 0/${chunks.length - 1}: ${docId}`);

    let lastHeading = "";
    const headingFromChunk = (m: string): string =>
      m.match(/^(#{1,6}\s+.+)$/m)?.[1] ?? "";
    lastHeading = headingFromChunk(chunks[0].markdown);

    for (let i = 1; i < chunks.length; i++) {
      let chunkMd = chunks[i].markdown;
      const currentHeading = headingFromChunk(chunkMd);
      if (currentHeading) { lastHeading = currentHeading; }
      else if (lastHeading) { chunkMd = lastHeading + "\n\n" + chunkMd; }

      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cli.appendDoc(docId, chunkMd)) { success = true; break; }
        await sleep(1000 * Math.pow(2, attempt));
      }
      if (!success) log(args.verbose, `WARNING: Chunk ${i}/${chunks.length - 1} failed`);
      else log(args.verbose, `Appended chunk ${i}/${chunks.length - 1}`);
    }
  }

  log(args.verbose, `Doc ready: ${docId}`);

  // 10. Images
  const imageRefs = extractImageRefs(md);
  if (imageRefs.length > 0) {
    log(args.verbose, `Images: ${imageRefs.length} references found`);
    try {
      const imgResult = processImages(cli, md, docId);
      log(args.verbose, `Images: ${imgResult.uploaded}/${imageRefs.length} uploaded`);
    } catch (err) { log(args.verbose, `Image error: ${(err as Error).message}`); }
  }

  // 11. Patches (heading backgrounds)
  const blocks = cli.getBlocks(docId);
  log(args.verbose, `Blocks: ${blocks.length}`);
  const patches = computePatches(blocks, args.bgMode);
  log(args.verbose, `Patches: ${patches.length}`);
  if (patches.length > 0) {
    const [ok, total] = executePatches(cli, docId, patches);
    log(args.verbose, `Patch result: ${ok}/${total}`);
  }

  // 12. Verify
  if (args.verify) {
    const report = verifyDoc(cli, docId);
    console.log(formatReport(report));
  }

  console.log(`\nDone. URL: ${docUrl}`);
}

main();
