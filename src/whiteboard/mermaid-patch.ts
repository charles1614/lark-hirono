/**
 * Mermaid whiteboard post-processing.
 *
 * After lark-cli creates whiteboard blocks from mermaid fences, this module
 * patches connector caption background colors via the lark-cli whiteboard
 * API (v1.0.8+):
 *
 * Flow:
 *   1. Query raw DSL via whiteboard +query --output_as raw
 *   2. Patch caption background colors in DSL
 *   3. Re-upload patched DSL via +whiteboard-update --input_format raw
 *
 * The whiteboard is already created by lark-cli during document creation
 * (from the mermaid fence). We only need to patch the caption styling.
 * Replaces the old whiteboard-cli external dependency approach.
 */

import type { LarkCli } from "../cli.js";
import { log } from "../logging.js";
import { MERMAID_EDGE_LABEL_BG } from "../core/normalize.js";

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait for sync context */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Extract mermaid block bodies (without fences) from markdown, in order. */
export function extractMermaidBlocks(md: string): string[] {
  const blocks: string[] = [];
  const re = /```mermaid\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(md)) !== null) blocks.push(m[1]);
  return blocks;
}

/** True if a mermaid source contains any labeled edges (|text|). */
function hasEdgeLabels(src: string): boolean {
  return /(-->|-\.->|==>)\s*\|[^|]+\|/.test(src);
}

// ─── Caption Patching ─────────────────────────────────────────────────────

/** Patch connector caption background colors in raw DSL nodes. */
function patchCaptionColors(nodes: any[], bgColor: string): number {
  let patched = 0;
  for (const node of nodes) {
    if (node.type !== "connector") continue;
    const caps: any[] = node.connector?.captions?.data ?? [];
    for (const cap of caps) {
      if (cap.text) {
        cap.text_background_color = bgColor;
        cap.text_background_color_type = 1;
        patched++;
      }
    }
  }
  return patched;
}

// ─── Main Entry ──────────────────────────────────────────────────────────

/**
 * Patch edge label background colors for all mermaid-derived whiteboards.
 *
 * The whiteboard was already created by lark-cli during document creation.
 * This function queries back the raw DSL, patches caption background colors,
 * and re-uploads the patched DSL. Requires lark-cli v1.0.8+ for whiteboard
 * +query support.
 *
 * boardTokens[i] must correspond to mermaidBlocks[i] — same order as mermaid
 * fences appeared in the uploaded markdown. Silently skips boards whose mermaid
 * source has no edge labels. Returns number of boards successfully patched.
 */
export function patchMermaidWhiteboards(
  boardTokens: string[],
  mermaidBlocks: string[],
  cli: LarkCli
): number {
  const count = Math.min(boardTokens.length, mermaidBlocks.length);
  if (count === 0) return 0;

  if (boardTokens.length !== mermaidBlocks.length) {
    log(`Whiteboard patch: token count (${boardTokens.length}) ≠ mermaid block count (${mermaidBlocks.length}), processing first ${count}`);
  }

  let ok = 0;
  for (let i = 0; i < count; i++) {
    const token = boardTokens[i];
    const src = mermaidBlocks[i];

    if (!hasEdgeLabels(src)) {
      ok++; // no labels → nothing to patch, not a failure
      continue;
    }

    // Step 1: Query raw DSL from the whiteboard that lark-cli already created
    // from the mermaid fence during document creation. Retry with backoff —
    // Feishu needs time to provision the whiteboard block ("doc data is not ready").
    let rawDsl: object | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 3000; // 3s, 6s, 9s
        log(`Whiteboard ${token}: retrying query in ${delay / 1000}s (attempt ${attempt + 1}/4)`);
        sleep(delay);
      }
      rawDsl = cli.queryWhiteboard(token);
      if (rawDsl && Array.isArray((rawDsl as any).nodes)) break;
      rawDsl = null;
    }
    if (!rawDsl) {
      log(`Whiteboard ${token}: query failed after retries, skipping caption patch`);
      continue;
    }

    // Step 3: Patch caption background colors
    const nodes = (rawDsl as any).nodes;
    const patched = patchCaptionColors(nodes, MERMAID_EDGE_LABEL_BG);

    if (patched === 0) {
      ok++; // no captions to patch
      continue;
    }

    // Step 4: Re-upload patched DSL
    const dslJson = JSON.stringify({ nodes });
    if (cli.updateWhiteboard(token, dslJson, "raw")) {
      log(`Whiteboard ${token}: ${patched} edge label backgrounds patched`);
      ok++;
    } else {
      log(`Whiteboard ${token}: patched DSL upload failed`);
    }
  }
  return ok;
}
