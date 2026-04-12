/**
 * Chunked upload — split large markdown into upload-safe chunks.
 *
 * Splits on heading boundaries (H1/H2) when possible.
 * Falls back to forced split when size limits are exceeded.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface ChunkConfig {
  /** Max lines per chunk (default: 300) */
  maxLines: number;
  /** Max bytes per chunk (default: 50KB) */
  maxBytes: number;
  /** Split on heading boundaries only (default: true) */
  splitOnHeadings: boolean;
}

export interface Chunk {
  index: number;
  markdown: string;
  lineCount: number;
  byteSize: number;
}

// ─── Splitting ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ChunkConfig = {
  maxLines: 300,
  maxBytes: 50_000,
  splitOnHeadings: true,
};

/**
 * Split markdown into chunks for upload.
 * Respects heading boundaries when possible.
 */
export function splitMarkdown(mdText: string, config: Partial<ChunkConfig> = {}): Chunk[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const lines = mdText.split("\n");
  const chunks: Chunk[] = [];

  const totalBytes = Buffer.byteLength(mdText, "utf-8");
  if (lines.length <= cfg.maxLines && totalBytes <= cfg.maxBytes) {
    return [{ index: 0, markdown: mdText, lineCount: lines.length, byteSize: totalBytes }];
  }

  let currentLines: string[] = [];
  let currentSize = 0;
  let chunkIndex = 0;
  let insideLarkTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = Buffer.byteLength(line, "utf-8") + 1;

    // Track lark-table blocks — never split inside one
    if (/<lark-table[\s>]/.test(line.trim())) insideLarkTable = true;
    const isClosingTable = /<\/lark-table>/.test(line.trim());
    if (isClosingTable) insideLarkTable = false;

    const isH2 = cfg.splitOnHeadings && /^#{1,2}\s/.test(line.trim());
    const effectiveMaxBytes = insideLarkTable ? cfg.maxBytes * 3 : cfg.maxBytes; // 3x limit inside tables
    const wouldExceedLines = currentLines.length >= cfg.maxLines;
    const wouldExceedBytes = currentSize + lineSize > effectiveMaxBytes;

    // Split after </lark-table> if chunk is already large
    if (currentLines.length > 0 && isClosingTable && currentSize > cfg.maxBytes / 2) {
      currentLines.push(line);
      currentSize += lineSize;
      chunks.push({
        index: chunkIndex++,
        markdown: currentLines.join("\n"),
        lineCount: currentLines.length,
        byteSize: currentSize,
      });
      currentLines = [];
      currentSize = 0;
      continue;
    }

    if (currentLines.length > 0 && isH2 && !insideLarkTable) {
      // Don't emit a chunk that's only blank lines — just discard them
      const hasContent = currentLines.some(l => l.trim());
      if (hasContent) {
        chunks.push({
          index: chunkIndex++,
          markdown: currentLines.join("\n"),
          lineCount: currentLines.length,
          byteSize: currentSize,
        });
      }
      currentLines = [];
      currentSize = 0;
    } else if (currentLines.length > 0 && (wouldExceedLines || wouldExceedBytes) && !insideLarkTable) {
      let splitAt = currentLines.length;
      for (let j = currentLines.length - 1; j >= 0; j--) {
        if (/^#{1,6}\s/.test(currentLines[j].trim())) {
          splitAt = j;
          break;
        }
      }
      const keepLines = currentLines.slice(0, splitAt);
      const carryLines = currentLines.slice(splitAt);

      if (keepLines.length > 0) {
        const keepMd = keepLines.join("\n");
        const keepSize = Buffer.byteLength(keepMd, "utf-8");
        chunks.push({
          index: chunkIndex++,
          markdown: keepMd,
          lineCount: keepLines.length,
          byteSize: keepSize,
        });
      }
      currentLines = carryLines;
      currentSize = carryLines.reduce((acc, l) => acc + Buffer.byteLength(l, "utf-8") + 1, 0);
    }

    currentLines.push(line);
    currentSize += lineSize;
  }

  if (currentLines.length > 0) {
    chunks.push({
      index: chunkIndex,
      markdown: currentLines.join("\n"),
      lineCount: currentLines.length,
      byteSize: currentSize,
    });
  }

  return chunks;
}
