/**
 * Mermaid whiteboard post-processing.
 *
 * After lark-cli creates whiteboard blocks from mermaid fences, this module
 * re-renders them via whiteboard-cli and patches connector caption background
 * colors in the DSL — bypassing Feishu's mermaid renderer limitations.
 *
 * Flow:
 *   mermaid source  →  whiteboard-cli (DSL)  →  patchCaptions  →  +whiteboard-update
 */

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LarkCli } from "../cli.js";
import { log } from "../logging.js";
import { MERMAID_EDGE_LABEL_BG } from "../core/normalize.js";

const WHITEBOARD_CLI_PKG = "@larksuite/whiteboard-cli@^0.1.0";

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

// ─── DSL Conversion ───────────────────────────────────────────────────────

/** Convert mermaid source to whiteboard OpenAPI DSL. Returns null on failure. */
function mermaidToDsl(src: string): object | null {
  const tmp = join(tmpdir(), `lark-hirono-${process.pid}-${Date.now()}.mmd`);
  try {
    writeFileSync(tmp, src, "utf-8");
    const out = execSync(
      `npx -y ${WHITEBOARD_CLI_PKG} --to openapi -i ${tmp} --format json`,
      { encoding: "utf-8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    const parsed = JSON.parse(out);
    if (parsed?.code !== 0 || !Array.isArray(parsed?.data?.result?.nodes)) return null;
    return parsed;
  } catch {
    return null;
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ─── Caption Patching ─────────────────────────────────────────────────────

/** Patch connector caption background colors in-place. Returns modified DSL. */
function patchCaptions(dsl: any, bgColor: string): any {
  const nodes: any[] = dsl?.data?.result?.nodes ?? [];

  dsl.data.result.nodes = nodes.map((node: any) => {
    if (node.type !== "connector") return node;
    const captions: any[] = node.connector?.captions?.data ?? [];
    if (captions.length === 0) return node;

    return {
      ...node,
      connector: {
        ...node.connector,
        captions: {
          ...node.connector.captions,
          data: captions.map((cap: any) => ({
            ...cap,
            text_background_color: bgColor,
            text_background_color_type: 1,
            rich_text: {
              ...cap.rich_text,
              paragraphs: (cap.rich_text?.paragraphs ?? []).map((para: any) => ({
                ...para,
                elements: (para.elements ?? []).map((el: any) =>
                  el.element_type === 0
                    ? {
                        ...el,
                        text_element: {
                          ...el.text_element,
                          text_style: {
                            ...el.text_element?.text_style,
                            background_color: bgColor,
                          },
                        },
                      }
                    : el
                ),
              })),
            },
          })),
        },
      },
    };
  });

  return dsl;
}

// ─── Main Entry ──────────────────────────────────────────────────────────

/**
 * Patch edge label background colors for all mermaid-derived whiteboards.
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

    const dsl = mermaidToDsl(src);
    if (!dsl) {
      log(`Whiteboard ${token}: DSL conversion failed, skipping`);
      continue;
    }

    const patched = patchCaptions(dsl, MERMAID_EDGE_LABEL_BG);

    if (cli.updateWhiteboard(token, JSON.stringify(patched))) {
      log(`Whiteboard ${token}: edge label backgrounds patched`);
      ok++;
    } else {
      log(`Whiteboard ${token}: upload failed`);
    }
  }
  return ok;
}
