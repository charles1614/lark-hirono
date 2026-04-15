/**
 * Block-level document copy — BFS reproduction of source block tree.
 *
 * Preserves ALL block-level styles by working at the API block level.
 * Uses createBlockChildrenEx to get created block IDs directly,
 * avoiding expensive getBlocks() calls in the copy loop.
 */

import { execSync, execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findLarkCli, type LarkCli } from "../cli.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ImageData {
  bytes: Buffer;
  width: number;
  height: number;
  align: number;
  scale: number;
}

export type ImageCache = Map<string, ImageData>;

export interface CopyResult {
  created: number;
  skipped: number;
}

type Block = Record<string, unknown>;
type PreparedBlock = Block & { _imageData?: ImageData; _extraRows?: number };
type QueueItem = [childIds: string[], parentId: string];

// ─── Constants ──────────────────────────────────────────────────────────

const CONTENT_KEY: Record<number, string> = {
  2: "text",
  3: "heading1", 4: "heading2", 5: "heading3",
  6: "heading4", 7: "heading5", 8: "heading6",
  9: "heading7", 10: "heading8", 11: "heading9",
  12: "bullet", 13: "ordered", 14: "code", 15: "quote",
  16: "equation", 17: "todo", 18: "table", 19: "callout",
  22: "divider", 24: "grid", 25: "grid_column", 27: "image",
  31: "table", 32: "table_cell", 34: "quote_container",
};

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 300;
const RETRY_DELAY_MS = 200;
const MAX_TABLE_ROWS = 9;

// ─── Block Preparation ──────────────────────────────────────────────────

function cleanContent(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(cleanContent);
  if (obj !== null && typeof obj === "object") {
    const out: Block = {};
    for (const [k, v] of Object.entries(obj as Block)) {
      if (k === "comment_ids") continue;
      out[k] = cleanContent(v);
    }
    return out;
  }
  return obj;
}

// ─── Heading Numbers ────────────────────────────────────────────────────

type HeadingNumbers = Map<string, string>;

/** Walk source blocks in document order and assign hierarchical numbers. */
export function computeHeadingNumbers(sourceBlocks: Block[]): HeadingNumbers {
  const blockMap = new Map(sourceBlocks.map((b) => [b.block_id as string, b]));
  const root = sourceBlocks.find((b) => b.block_type === 1);
  if (!root) return new Map();

  const counters = new Array(10).fill(0); // counters[1..9]
  const result: HeadingNumbers = new Map();

  function walk(ids: string[]): void {
    for (const id of ids) {
      const b = blockMap.get(id);
      if (!b) continue;
      const bt = b.block_type as number;

      if (bt >= 3 && bt <= 11) {
        const level = bt - 2; // 1..9
        counters[level]++;
        for (let j = level + 1; j < 10; j++) counters[j] = 0;
        const parts: string[] = [];
        for (let j = 1; j <= level; j++) parts.push(String(counters[j]));
        // Skip leading zeros
        while (parts.length > 0 && parts[0] === "0") parts.shift();
        result.set(id, parts.length > 0 ? parts.join(".") + " " : "");
      }

      if (b.children) walk(b.children as string[]);
    }
  }

  walk((root.children as string[]) ?? []);
  return result;
}

// ─── Block Preparation ──────────────────────────────────────────────────

function prepareBlock(src: Block, imageCache: ImageCache, headingNumbers?: HeadingNumbers): PreparedBlock | null {
  const bt = src.block_type as number;

  // Skip root, auto-created grid_column, table_cell
  if (bt === 1 || bt === 25 || bt === 32) return null;

  const key = CONTENT_KEY[bt];
  if (key === undefined) return null;

  const block: PreparedBlock = { block_type: bt };

  if (key in src) {
    const content = cleanContent(src[key]) as Block;

    // Prepend heading number (styled blue)
    if (bt >= 3 && bt <= 11 && headingNumbers) {
      const num = headingNumbers.get(src.block_id as string);
      if (num) {
        const elements = (content.elements as Array<Block>) ?? [];
        // Strip existing manual numbers from first element
        if (elements.length > 0 && elements[0].text_run) {
          const first = elements[0].text_run as Block;
          const old = (first.content as string) ?? "";
          const stripped = old.replace(/^(\d+\.)*\d+\.?\s+/, "");
          if (stripped !== old) first.content = stripped;
        }
        const numElement = {
          text_run: {
            content: num,
            text_element_style: { text_color: 5 }, // blue
          },
        };
        content.elements = [numElement, ...elements];
      }
    }

    if (bt === 18 || bt === 31) {
      delete content.cells;
      const prop = content.property as Block | undefined;
      if (prop) {
        delete prop.merge_info;
        // Keep header_row and header_column — they are valid create params
        const origRows = (prop.row_size as number) ?? 0;
        if (origRows > MAX_TABLE_ROWS) {
          block._extraRows = origRows - MAX_TABLE_ROWS;
          prop.row_size = MAX_TABLE_ROWS;
        }
      }
    }

    if (bt === 27) {
      const oldToken = (content.token as string) ?? "";
      if (oldToken && imageCache.has(oldToken)) {
        block._imageData = imageCache.get(oldToken)!;
      } else if (oldToken) {
        return null;
      }
      block[key] = {};
      return block;
    }

    block[key] = content;
  }

  return block;
}

function stripInternal(b: PreparedBlock): Block {
  const clean: Block = {};
  for (const [k, v] of Object.entries(b)) {
    if (!k.startsWith("_")) clean[k] = v;
  }
  return clean;
}

// ─── Image Upload ───────────────────────────────────────────────────────

const TMP_DIR = join(tmpdir(), "lark-hirono-block-upload");

function uploadImageToBlock(
  cli: LarkCli,
  docId: string,
  blockId: string,
  img: ImageData,
): boolean {
  const cliPath = findLarkCli();
  mkdirSync(TMP_DIR, { recursive: true });
  const filename = `${blockId}.png`;
  const filepath = join(TMP_DIR, filename);

  try {
    writeFileSync(filepath, img.bytes);
    const out = execFileSync(cliPath, [
      "api", "POST", "/open-apis/drive/v1/medias/upload_all",
      "--data", JSON.stringify({
        file_name: "image.png",
        parent_type: "docx_image",
        parent_node: blockId,
        size: String(img.bytes.length),
      }),
      "--file", `file=${filename}`,
    ], { cwd: TMP_DIR, encoding: "utf-8", timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] });

    const parsed = JSON.parse(out);
    if (parsed.code !== 0 || !parsed.data?.file_token) return false;
    const fileToken = parsed.data.file_token as string;

    const body: Block = { token: fileToken, width: img.width, height: img.height };
    if (img.align) body.align = img.align;
    if (img.scale) body.scale = img.scale;
    return cli.patchBlock(docId, blockId, { replace_image: body });
  } catch {
    return false;
  } finally {
    try { unlinkSync(filepath); } catch { /* ignore */ }
  }
}

// ─── Table Row Expansion ────────────────────────────────────────────────

function insertExtraTableRows(cli: LarkCli, docId: string, tableBlockId: string, extraRows: number): void {
  for (let i = 0; i < extraRows; i++) {
    cli.patchBlock(docId, tableBlockId, { insert_table_row: { row_index: MAX_TABLE_ROWS + i } });
    sleep(RETRY_DELAY_MS);
  }
}

// ─── Auto-Created Children ──────────────────────────────────────────────

function getAutoChildren(cli: LarkCli, docId: string, newBlk: Block): string[] {
  const ids = newBlk.children as string[] | undefined;
  if (ids && ids.length > 0) return ids;
  // Fetch single block — fast, no pagination
  const fresh = cli.getBlock(docId, newBlk.block_id as string);
  return (fresh?.children as string[]) ?? [];
}

function queueChildren(
  cli: LarkCli, docId: string, newBlk: Block, srcBlk: Block,
  blockMap: Map<string, Block>, next: QueueItem[],
): void {
  const bt = srcBlk.block_type as number;

  if (bt === 18 || bt === 31) {
    const newCellIds = getAutoChildren(cli, docId, newBlk);
    const srcCells = (srcBlk.table as Block)?.cells as string[] | string[][] | undefined;
    if (!srcCells) return;
    const flat = Array.isArray(srcCells[0]) ? (srcCells as string[][]).flat() : srcCells as string[];
    for (let k = 0; k < flat.length && k < newCellIds.length; k++) {
      const sc = blockMap.get(flat[k]);
      if (sc?.children) next.push([sc.children as string[], newCellIds[k]]);
    }
  } else if (bt === 24) {
    const newColIds = getAutoChildren(cli, docId, newBlk);
    const srcColIds = srcBlk.children as string[] | undefined;
    if (!srcColIds) return;
    for (let k = 0; k < srcColIds.length && k < newColIds.length; k++) {
      const sc = blockMap.get(srcColIds[k]);
      if (sc?.children) next.push([sc.children as string[], newColIds[k]]);
    }
  } else if (srcBlk.children) {
    next.push([srcBlk.children as string[], newBlk.block_id as string]);
  }
}

// ─── BFS Copy Engine ────────────────────────────────────────────────────

export function copyDocBlocks(
  cli: LarkCli, sourceBlocks: Block[], targetDocId: string,
  imageCache: ImageCache, opts?: { verbose?: boolean; headingNumbers?: HeadingNumbers },
): CopyResult {
  const blockMap = new Map(sourceBlocks.map((b) => [b.block_id as string, b]));
  const root = sourceBlocks.find((b) => b.block_type === 1);
  if (!root) throw new Error("No root block in source document");

  const rootChildren = root.children as string[] | undefined;
  if (!rootChildren || rootChildren.length === 0) return { created: 0, skipped: 0 };

  const queue: QueueItem[] = [[rootChildren, targetDocId]];
  let totalCreated = 0;
  let totalSkipped = 0;

  while (queue.length > 0) {
    const next: QueueItem[] = [];

    for (const [childIds, parentId] of queue) {
      if (!childIds || childIds.length === 0) continue;

      // Expand unsupported types by promoting children
      const expandedIds: string[] = [];
      for (const cid of childIds) {
        const s = blockMap.get(cid);
        if (!s) continue;
        const bt = s.block_type as number;
        if (bt !== 1 && !(bt in CONTENT_KEY)) {
          expandedIds.push(...((s.children as string[]) ?? []));
        } else {
          expandedIds.push(cid);
        }
      }

      // Prepare blocks
      const pairs: Array<[PreparedBlock, Block]> = [];
      for (const cid of expandedIds) {
        const s = blockMap.get(cid);
        if (!s) continue;
        const b = prepareBlock(s, imageCache, opts?.headingNumbers);
        if (b) pairs.push([b, s]);
      }

      // Create in batches
      let insertPos = 0;
      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        const chunk = pairs.slice(i, i + BATCH_SIZE);
        const batch = chunk.map(([b]) => stripInternal(b));

        let created: Block[] | null = null;
        try {
          created = cli.createBlockChildrenEx(targetDocId, parentId, batch, insertPos);
        } catch {
          created = null;
        }

        if (created && created.length > 0) {
          totalCreated += created.length;
          insertPos += created.length;
          processCreatedBlocks(cli, targetDocId, created, chunk, blockMap, next, opts);
        } else {
          // Batch failed — retry one by one
          if (opts?.verbose) console.log("    Batch failed, retrying one-by-one…");
          for (const [single, srcBlk] of chunk) {
            try {
              const oneResult = cli.createBlockChildrenEx(
                targetDocId, parentId, [stripInternal(single)], insertPos,
              );
              if (oneResult && oneResult.length > 0) {
                totalCreated++;
                insertPos++;
                processCreatedBlocks(cli, targetDocId, oneResult, [[single, srcBlk]], blockMap, next, opts);
              } else {
                totalSkipped++;
              }
            } catch {
              totalSkipped++;
            }
            sleep(RETRY_DELAY_MS);
          }
        }

        sleep(BATCH_DELAY_MS);
      }
    }

    queue.length = 0;
    queue.push(...next);
  }

  return { created: totalCreated, skipped: totalSkipped };
}

/** Post-creation: upload images, expand tables, queue children. */
function processCreatedBlocks(
  cli: LarkCli, docId: string,
  created: Block[],
  chunk: Array<[PreparedBlock, Block]>,
  blockMap: Map<string, Block>,
  next: QueueItem[],
  opts?: { verbose?: boolean },
): void {
  for (let j = 0; j < created.length && j < chunk.length; j++) {
    const newBlk = created[j];
    const [prepared, srcBlk] = chunk[j];
    const newId = newBlk.block_id as string;
    if (!newId) continue;

    // Upload image
    if (prepared._imageData) {
      const ok = uploadImageToBlock(cli, docId, newId, prepared._imageData);
      if (opts?.verbose && ok) console.log("    Uploaded image to block");
    }

    // Expand large tables
    if (prepared._extraRows) {
      insertExtraTableRows(cli, docId, newId, prepared._extraRows);
      if (opts?.verbose) console.log(`    Inserted ${prepared._extraRows} extra table rows`);
      // Re-fetch this single block to get updated children after row insertion
      const fresh = cli.getBlock(docId, newId);
      if (fresh) {
        queueChildren(cli, docId, fresh, srcBlk, blockMap, next);
        continue;
      }
    }

    queueChildren(cli, docId, newBlk, srcBlk, blockMap, next);
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────

export function cleanupEmptyTails(
  cli: LarkCli, docId: string, sourceBlocks: Block[],
): number {
  const dstBlocks = cli.getBlocks(docId);
  const dstMap = new Map(dstBlocks.map((b) => [b.block_id as string, b]));

  const containerTypes = new Set([19, 25, 32, 34]);
  const srcContainers = sourceBlocks.filter((b) => containerTypes.has(b.block_type as number));
  const dstContainers = dstBlocks.filter((b) => containerTypes.has(b.block_type as number));

  let deleted = 0;
  for (let i = 0; i < srcContainers.length && i < dstContainers.length; i++) {
    const sc = srcContainers[i];
    const dc = dstContainers[i];
    if (sc.block_type !== dc.block_type) continue;

    const srcN = ((sc.children as string[]) ?? []).length;
    const dstKids = (dc.children as string[]) ?? [];
    if (dstKids.length <= srcN) continue;

    let allEmpty = true;
    for (const kidId of dstKids.slice(srcN)) {
      const kid = dstMap.get(kidId);
      if (!kid || (kid.block_type as number) !== 2) { allEmpty = false; break; }
      const elems = ((kid.text as Block)?.elements as Array<Block>) ?? [];
      const text = elems.map((e) => ((e.text_run as Block)?.content as string) ?? "").join("");
      if (text.trim()) { allEmpty = false; break; }
    }

    if (allEmpty) {
      try {
        cli.deleteBlockChildrenTail(docId, dc.block_id as string, srcN, dstKids.length);
        deleted += dstKids.length - srcN;
      } catch { /* ignore */ }
    }
  }

  return deleted;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): void {
  execSync(`sleep ${ms / 1000}`);
}
