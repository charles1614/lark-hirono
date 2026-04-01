/**
 * Compute all patches needed for a document's blocks.
 *
 * Rainbow is based on relative heading depth in the body, not block_type:
 * - Highest level heading → LightRedBackground
 * - Next level → LightOrangeBackground
 * - And so on...
 */

import type { LarkCli } from "./cli.js";

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

  // Find minimum heading level in body
  let minHeadingLevel = Infinity;
  for (const b of blocks) {
    const bt = b.block_type as number;
    if (bt >= 3 && bt <= 11) {
      minHeadingLevel = Math.min(minHeadingLevel, bt - 2);
    }
  }
  if (minHeadingLevel === Infinity) minHeadingLevel = 1;

  for (const b of blocks) {
    const bt = b.block_type as number;
    const bid = b.block_id as string;

    // Heading blocks (type 3-11)
    if (bt >= 3 && bt <= 11) {
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
