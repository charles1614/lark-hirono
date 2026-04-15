/**
 * Reference fixup — remap document links in copied pages.
 *
 * After copying a wiki subtree, internal links still point to the source.
 * This module rewrites mention_doc elements and text_run links to point
 * to the corresponding target pages.
 */

import { execSync } from "node:child_process";
import type { LarkCli } from "../cli.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface RefMaps {
  /** source_node_token → target_node_token (for /wiki/ URLs) */
  nodeMap: Map<string, string>;
  /** source_obj_token → target_obj_token (for /docx/ URLs and mention_doc.token) */
  objMap: Map<string, string>;
  /** target_node_token → target_obj_token (for iterating target pages) */
  docMap: Map<string, string>;
}

type Block = Record<string, unknown>;
type Element = Record<string, unknown>;

const CONTENT_KEY: Record<number, string> = {
  2: "text",
  3: "heading1", 4: "heading2", 5: "heading3",
  6: "heading4", 7: "heading5", 8: "heading6",
  9: "heading7", 10: "heading8", 11: "heading9",
  12: "bullet", 13: "ordered", 14: "code", 15: "quote",
  16: "equation", 17: "todo", 18: "table", 19: "callout",
  34: "quote_container",
};

// ─── URL Remapping ──────────────────────────────────────────────────────

function remapUrl(
  url: string,
  nodeMap: Map<string, string>,
  objMap: Map<string, string>,
  blockIdMap?: Map<string, string>,
): string | null {
  let newUrl = url;
  let changed = false;

  // Try node_map (/wiki/{node_token})
  for (const [src, dst] of nodeMap) {
    if (newUrl.includes(src)) {
      newUrl = newUrl.replace(src, dst);
      changed = true;
      break;
    }
  }

  // Try obj_map (/docx/{obj_token})
  if (!changed) {
    for (const [src, dst] of objMap) {
      if (newUrl.includes(src)) {
        newUrl = newUrl.replace(src, dst);
        changed = true;
        break;
      }
    }
  }

  // Remap #anchor fragment (block IDs)
  if (blockIdMap) {
    for (const sep of ["#", "%23"]) {
      if (newUrl.includes(sep)) {
        const idx = newUrl.lastIndexOf(sep);
        const base = newUrl.slice(0, idx);
        const fragment = newUrl.slice(idx + sep.length);
        if (blockIdMap.has(fragment)) {
          newUrl = `${base}${sep}${blockIdMap.get(fragment)!}`;
          changed = true;
        }
        break;
      }
    }
  }

  return changed ? newUrl : null;
}

function remapElements(
  elements: Element[],
  nodeMap: Map<string, string>,
  objMap: Map<string, string>,
  blockIdMap?: Map<string, string>,
): boolean {
  let changed = false;

  for (const elem of elements) {
    if (elem.mention_doc) {
      const doc = elem.mention_doc as Record<string, string>;
      const newUrl = remapUrl(doc.url ?? "", nodeMap, objMap, blockIdMap);
      if (newUrl) { doc.url = newUrl; changed = true; }
      if (doc.token && objMap.has(doc.token)) {
        doc.token = objMap.get(doc.token)!;
        changed = true;
      }
    } else if (elem.text_run) {
      const style = (elem.text_run as Block).text_element_style as Block | undefined;
      const link = style?.link as Record<string, string> | undefined;
      if (link?.url) {
        const newUrl = remapUrl(link.url, nodeMap, objMap, blockIdMap);
        if (newUrl) { link.url = newUrl; changed = true; }
      }
    }
  }

  return changed;
}

// ─── Block ID Mapping ───────────────────────────────────────────────────

function buildBlockIdMap(
  cli: LarkCli,
  sourceObjToken: string,
  targetObjToken: string,
): Map<string, string> {
  const srcBlocks = cli.getBlocks(sourceObjToken);
  const tgtBlocks = cli.getBlocks(targetObjToken);

  const map = new Map<string, string>();
  const len = Math.min(srcBlocks.length, tgtBlocks.length);
  for (let i = 0; i < len; i++) {
    map.set(srcBlocks[i].block_id as string, tgtBlocks[i].block_id as string);
  }
  return map;
}

// ─── Clean Elements ─────────────────────────────────────────────────────

function cleanElements(elements: unknown): unknown {
  if (Array.isArray(elements)) return elements.map(cleanElements);
  if (elements !== null && typeof elements === "object") {
    const out: Block = {};
    for (const [k, v] of Object.entries(elements as Block)) {
      if (k === "comment_ids") continue;
      out[k] = cleanElements(v);
    }
    return out;
  }
  return elements;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Post-copy pass: update document references in all copied pages.
 * Returns number of blocks updated.
 */
export function fixupReferences(
  cli: LarkCli,
  refs: RefMaps,
  opts?: { verbose?: boolean },
): number {
  if (refs.nodeMap.size === 0) return 0;

  console.log(`Fixing references across ${refs.docMap.size} page(s)…`);
  let fixedBlocks = 0;
  let fixedPages = 0;

  const blockIdMapCache = new Map<string, Map<string, string>>();

  for (const [newNodeToken, newDocId] of refs.docMap) {
    let blocks: Block[];
    try {
      blocks = cli.getBlocks(newDocId);
    } catch {
      continue;
    }

    // Collect source obj_tokens referenced by anchor URLs
    const referencedObjs = new Set<string>();
    for (const block of blocks) {
      const bt = block.block_type as number;
      const key = CONTENT_KEY[bt];
      if (!key || !(key in block)) continue;
      const elements = ((block[key] as Block).elements as Element[]) ?? [];
      for (const el of elements) {
        let url = "";
        if (el.text_run) {
          url = ((el.text_run as Block).text_element_style as Block)?.link
            ? (((el.text_run as Block).text_element_style as Block).link as Block).url as string ?? ""
            : "";
        } else if (el.mention_doc) {
          url = (el.mention_doc as Block).url as string ?? "";
        }
        if (!url.includes("#") && !url.includes("%23")) continue;
        for (const [srcObj] of refs.objMap) {
          if (url.includes(srcObj)) { referencedObjs.add(srcObj); break; }
        }
      }
    }

    // Build block_id maps lazily for pages with anchor refs
    const blockIdMap = new Map<string, string>();
    for (const srcObj of referencedObjs) {
      if (blockIdMapCache.has(srcObj)) {
        for (const [k, v] of blockIdMapCache.get(srcObj)!) blockIdMap.set(k, v);
      } else {
        const tgtObj = refs.objMap.get(srcObj);
        if (!tgtObj) continue;
        try {
          const map = buildBlockIdMap(cli, srcObj, tgtObj);
          blockIdMapCache.set(srcObj, map);
          for (const [k, v] of map) blockIdMap.set(k, v);
        } catch { /* skip */ }
      }
    }

    // Scan and fix references
    let pageFixed = 0;
    for (const block of blocks) {
      const bt = block.block_type as number;
      const key = CONTENT_KEY[bt];
      if (!key || !(key in block)) continue;
      const elements = ((block[key] as Block).elements as Element[]) ?? [];
      if (elements.length === 0) continue;

      // Deep copy before modifying
      const newElements = JSON.parse(JSON.stringify(elements)) as Element[];
      if (!remapElements(newElements, refs.nodeMap, refs.objMap, blockIdMap.size > 0 ? blockIdMap : undefined)) {
        continue;
      }

      const cleaned = cleanElements(newElements) as Element[];
      const ok = cli.updateBlockElements(newDocId, block.block_id as string, cleaned as Record<string, unknown>[]);
      if (ok) {
        pageFixed++;
      } else {
        // Fallback: convert mention_doc to text_run links
        const hasMention = cleaned.some((el) => el.mention_doc);
        if (hasMention) {
          for (let i = 0; i < cleaned.length; i++) {
            if (cleaned[i].mention_doc) {
              const doc = cleaned[i].mention_doc as Block;
              cleaned[i] = {
                text_run: {
                  content: (doc.title as string) ?? "link",
                  text_element_style: {
                    link: { url: encodeURIComponent((doc.url as string) ?? "") },
                  },
                },
              };
            }
          }
          if (cli.updateBlockElements(newDocId, block.block_id as string, cleaned as Record<string, unknown>[])) {
            pageFixed++;
          }
        }
      }

      sleep(300);
    }

    if (pageFixed > 0) {
      fixedBlocks += pageFixed;
      fixedPages++;
      if (opts?.verbose) {
        console.log(`  Fixed ${pageFixed} ref(s) in ${newNodeToken}`);
      }
    }
  }

  console.log(`Reference fixup: ${fixedBlocks} block(s) in ${fixedPages} page(s)`);
  return fixedBlocks;
}

function sleep(ms: number): void {
  execSync(`sleep ${ms / 1000}`);
}
