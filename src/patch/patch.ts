/**
 * Compute all patches needed for a document's blocks.
 *
 * Rainbow is based on relative heading depth in the body, not block_type:
 * - Highest level heading → LightRedBackground
 * - Next level → LightOrangeBackground
 * - And so on...
 */

import type { LarkCli } from "../cli.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type BgMode = "light" | "dark";

export interface Patch {
  blockId: string;
  bg: string;
  label: string;
}

// ─── Color Maps ─────────────────────────────────────────────────────────

const LIGHT_BG_RAINBOW = [
  "LightRedBackground",
  "LightOrangeBackground",
  "LightYellowBackground",
  "LightGreenBackground",
  "LightBlueBackground",
  "LightPurpleBackground",
];

const DARK_BG_RAINBOW = [
  "DarkRedBackground",
  "DarkOrangeBackground",
  "DarkYellowBackground",
  "DarkGreenBackground",
  "DarkBlueBackground",
  "DarkPurpleBackground",
];

// Integer color → light string (for bold/int text blocks)
const INT_BG_TO_LIGHT: Record<number, string> = {
  11: "LightGreenBackground",
  4: "LightOrangeBackground",
  14: "LightBlueBackground",
  2: "LightRedBackground",
  10: "DarkRedBackground",
};

const TABLE_BLOCK_TYPES = new Set([31, 32]);

function isHeadingBlock(block: Record<string, unknown>): boolean {
  const bt = block.block_type as number;
  return bt >= 3 && bt <= 11;
}

function isInsideTable(block: Record<string, unknown>, blockById: Map<string, Record<string, unknown>>): boolean {
  let parentId = block.parent_id as string | undefined;
  const seen = new Set<string>();

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = blockById.get(parentId);
    if (!parent) return false;
    const parentType = parent.block_type as number;
    if (TABLE_BLOCK_TYPES.has(parentType)) return true;
    parentId = parent.parent_id as string | undefined;
  }

  return false;
}

// ─── Patch Computation ──────────────────────────────────────────────────

/**
 * Compute all patches needed for a document's blocks.
 *
 * Block types (Lark docx):
 *   3=H1, 4=H2, 5=H3, 6=H4, 7=H5, 8=H6, 9=H7, 10=H8, 11=H9
 *
 * Rainbow shifts to match actual heading levels in the body:
 * - If body starts at H2, then H2=red, H3=orange, H4=yellow, ...
 */
export function computePatches(
  blocks: Record<string, unknown>[],
  bgMode: BgMode = "light"
): Patch[] {
  const bgRainbow = bgMode === "dark" ? DARK_BG_RAINBOW : LIGHT_BG_RAINBOW;
  const patches: Patch[] = [];
  const blockById = new Map(blocks.map(b => [b.block_id as string, b]));
  const bodyHeadingBlocks = blocks.filter(b => isHeadingBlock(b) && !isInsideTable(b, blockById));

  // Count H1 blocks (block_type 3)
  const h1Count = bodyHeadingBlocks.filter(b => b.block_type === 3).length;
  const skipH1 = h1Count === 1; // Single H1 = title, skip it

  // Find minimum heading level in body
  let minHeadingLevel = Infinity;
  for (const b of bodyHeadingBlocks) {
    const bt = b.block_type as number;
    // Skip H1 if it's the only one (treat as title)
    if (skipH1 && bt === 3) continue;
    minHeadingLevel = Math.min(minHeadingLevel, bt - 2);
  }
  if (minHeadingLevel === Infinity) minHeadingLevel = skipH1 ? 2 : 1;

  for (const b of blocks) {
    const bt = b.block_type as number;
    const bid = b.block_id as string;

    // Heading blocks (type 3-11)
    if (bt >= 3 && bt <= 11) {
      if (isInsideTable(b, blockById)) continue;

      // Skip H1 if it's the only one (treat as title, don't color it)
      if (skipH1 && bt === 3) continue;

      const level = bt - 2;
      const depth = level - minHeadingLevel; // 0-based depth
      const bg = bgRainbow[depth] ?? bgRainbow[bgRainbow.length - 1];
      patches.push({ blockId: bid, bg, label: `H${level}` });
      continue;
    }

    // Text blocks with integer background color
    for (const key of ["text", "bullet", "ordered"]) {
      const v = b[key];
      if (!v || typeof v !== "object") continue;
      const elements = (v as any).elements;
      if (!Array.isArray(elements)) continue;

      for (const e of elements) {
        const style = e?.text_run?.text_element_style;
        const bgInt = style?.background_color;
        if (typeof bgInt === "number" && bgInt in INT_BG_TO_LIGHT) {
          patches.push({ blockId: bid, bg: INT_BG_TO_LIGHT[bgInt], label: `text:${bgInt}` });
        }
      }
    }
  }

  return patches;
}

// ─── Empty Tail Cleanup ─────────────────────────────────────────────────

/**
 * Strip Feishu's auto-added trailing newline from code block elements.
 *
 * When lark-cli creates a document, the markdown parser appends \n to the
 * last element of every code block (block_type 14). Feishu renders this as
 * a visible blank line at the bottom of the code block in the UI.
 *
 * The Feishu PATCH API does not support updating code block element content
 * (returns 1770001 invalid param). Instead, delete the block and recreate it
 * without the trailing \n — same approach as feishu_tool.py's _make_code().
 *
 * Returns number of code blocks fixed.
 */
export function cleanupEmptyTails(
  cli: LarkCli,
  docId: string,
  blocks: Record<string, unknown>[]
): number {
  // Build block map for parent/children lookup
  const bmap = new Map<string, Record<string, unknown>>();
  for (const b of blocks) {
    bmap.set(b.block_id as string, b);
  }

  // Collect code blocks that need fixing, with their parent index
  const toFix: Array<{ block: Record<string, unknown>; parentId: string; index: number }> = [];

  for (const block of blocks) {
    if (block.block_type !== 14) continue;
    const elements = ((block as any).code?.elements ?? []) as any[];
    if (elements.length === 0) continue;

    const last = elements[elements.length - 1];
    const content: string = last?.text_run?.content ?? "";
    if (!content.endsWith("\n")) continue;

    const parentId = block.parent_id as string | undefined;
    if (!parentId) continue;
    const parent = bmap.get(parentId);
    if (!parent) continue;

    const parentChildren = (parent.children ?? []) as string[];
    const index = parentChildren.indexOf(block.block_id as string);
    if (index === -1) continue;

    toFix.push({ block, parentId, index });
  }

  if (toFix.length === 0) return 0;

  // Process in reverse index order per parent to avoid index shifting
  toFix.sort((a, b) => {
    if (a.parentId !== b.parentId) return a.parentId.localeCompare(b.parentId);
    return b.index - a.index; // highest index first within same parent
  });

  let patched = 0;

  for (const { block, parentId, index } of toFix) {
    const elements = ((block as any).code?.elements ?? []) as any[];
    const last = elements[elements.length - 1];
    const content: string = last?.text_run?.content ?? "";
    const stripped = content.replace(/\n$/, "");

    const fixedElements = elements.map((e: any, i: number) =>
      i === elements.length - 1
        ? { ...e, text_run: { ...e.text_run, content: stripped } }
        : e
    );

    const style = (block as any).code?.style ?? {};
    const newBlock: Record<string, unknown> = {
      block_type: 14,
      code: { elements: fixedElements, style },
    };

    // Delete the code block at its current position
    const deleted = cli.deleteBlockChildrenTail(docId, parentId, index, index + 1);
    if (!deleted) {
      console.error(`  cleanupEmptyTails: delete failed at index ${index} in ${parentId}`);
      continue;
    }

    // Small delay to let the revision settle
    const t = Date.now();
    while (Date.now() - t < 300) { /* busy wait */ }

    // Recreate without trailing \n — retry once on failure to avoid orphaned deletion
    let created = cli.createBlockChildren(docId, parentId, [newBlock], index);
    if (!created) {
      const t3 = Date.now();
      while (Date.now() - t3 < 1000) { /* busy wait */ }
      created = cli.createBlockChildren(docId, parentId, [newBlock], index);
    }
    if (created) {
      patched++;
    } else {
      console.error(`  cleanupEmptyTails: recreate failed (2 attempts) at index ${index} in ${parentId} — block may be missing`);
    }

    // Rate limit
    const t2 = Date.now();
    while (Date.now() - t2 < 500) { /* busy wait */ }
  }

  return patched;
}

// ─── Patch Execution ────────────────────────────────────────────────────

/**
 * Execute patches sequentially with rate limiting.
 * Returns [successCount, totalCount].
 */
export function executePatches(
  cli: LarkCli,
  docId: string,
  patches: Patch[],
  delayMs = 500
): [number, number] {
  let ok = 0;

  for (const p of patches) {
    const payload = {
      update_text_style: {
        style: { background_color: p.bg },
        fields: [6],
      },
    };

    if (cli.patchBlock(docId, p.blockId, payload)) {
      ok++;
    } else {
      console.error(`  FAIL: ${p.blockId} (${p.label})`);
    }

    // Rate limit
    if (delayMs > 0) {
      const start = Date.now();
      while (Date.now() - start < delayMs) {
        /* busy wait for sub-ms precision */
      }
    }
  }

  return [ok, patches.length];
}
