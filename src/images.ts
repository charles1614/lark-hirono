/**
 * Image handling — download remote images, upload to Feishu drive, embed in doc blocks.
 *
 * Uses lark-cli for:
 * - drive +upload (single-shot, ≤20MB)
 * - docx API for inserting image blocks
 */

import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findLarkCli } from "./cli.js";
import type { LarkCli } from "./cli.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ImageRef {
  /** Full match text (for replacement) */
  fullMatch: string;
  /** Original URL */
  url: string;
  /** Alt text / caption */
  alt: string;
  /** Line number (0-based) */
  line: number;
  /** Is HTML <image> tag (vs markdown ![alt](url)) */
  isHtml: boolean;
}

export interface ImageProcessResult {
  markdown: string;
  downloaded: number;
  uploaded: number;
  failed: number;
  errors: string[];
}

// ─── Regex ──────────────────────────────────────────────────────────────

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HTML_IMAGE_RE = /<image\s+url="([^"]+)"([^>]*)\/>/g;

// ─── Config ─────────────────────────────────────────────────────────────

const TMP_DIR = join(tmpdir(), "feishu_images");
const CLI_PATH = findLarkCli();

// ─── Download ───────────────────────────────────────────────────────────

/**
 * Download an image from URL to a temp file.
 * Returns local file path. Throws on failure.
 */
export function downloadImage(url: string, filename?: string): string {
  mkdirSync(TMP_DIR, { recursive: true });

  const name = filename ?? `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = guessExtension(url);
  const localPath = join(TMP_DIR, name + ext);

  execFileSync(
    "curl",
    ["-sL", "-o", localPath, "--max-time", "30", "--retry", "2", url],
    { timeout: 35_000 }
  );

  if (!existsSync(localPath) || statSync(localPath).size === 0) {
    throw new Error(`Download failed: ${url}`);
  }

  return localPath;
}

function guessExtension(url: string): string {
  const match = url.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i);
  if (match) return "." + match[1].toLowerCase();
  return ".png";
}

// ─── Upload ─────────────────────────────────────────────────────────────

/**
 * Upload a local image file to Feishu drive via lark-cli.
 * Returns the file_token on success.
 */
export function uploadImage(localPath: string): string {
  const filename = localPath.split("/").pop() ?? "image.png";
  // CLI requires relative paths; cd to the file's directory first
  const dir = localPath.substring(0, localPath.lastIndexOf("/")) || ".";
  const basename = localPath.substring(localPath.lastIndexOf("/") + 1);

  const result = execFileSync(CLI_PATH, [
    "drive", "+upload",
    "--file", `./${basename}`,
    "--name", filename,
  ], {
    cwd: dir,
    encoding: "utf-8",
    timeout: 60_000,
  });

  const parsed = JSON.parse(result);
  if (parsed.ok && parsed.data?.file_token) {
    return parsed.data.file_token;
  }

  throw new Error(`Upload failed: ${parsed.error?.message ?? parsed.msg ?? "unknown error"}`);
}

/**
 * Insert an image block into a document via lark-cli API.
 */
export function insertImageBlock(
  cli: LarkCli,
  docId: string,
  fileToken: string,
  width?: number,
  height?: number
): boolean {
  const imageBlock: Record<string, unknown> = { token: fileToken };
  if (width) imageBlock.width = width;
  if (height) imageBlock.height = height;

  const result = cli.post(
    `/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children?document_revision_id=-1`,
    {
      children: [{ block_type: 27, image: imageBlock }],
      index: -1,
    }
  );

  return result !== null && result.code === 0;
}

// ─── Extract ────────────────────────────────────────────────────────────

/**
 * Extract all image references from markdown.
 */
export function extractImageRefs(mdText: string): ImageRef[] {
  const refs: ImageRef[] = [];
  const lines = mdText.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Markdown images: ![alt](url)
    for (const m of line.matchAll(MD_IMAGE_RE)) {
      refs.push({
        fullMatch: m[0],
        url: m[2],
        alt: m[1],
        line: lineIdx,
        isHtml: false,
      });
    }

    // HTML images: <image url="..." .../>
    for (const m of line.matchAll(HTML_IMAGE_RE)) {
      refs.push({
        fullMatch: m[0],
        url: m[1],
        alt: "",
        line: lineIdx,
        isHtml: true,
      });
    }
  }

  return refs;
}

// ─── Process ────────────────────────────────────────────────────────────

/**
 * Process all images in markdown: download → upload → insert blocks.
 *
 * Images are downloaded, uploaded to Feishu, and inserted as blocks
 * into the document. The markdown is updated to remove the image
 * references (since they're now embedded as blocks).
 */
export function processImages(
  cli: LarkCli,
  mdText: string,
  docId: string
): ImageProcessResult {
  const refs = extractImageRefs(mdText);
  const result: ImageProcessResult = {
    markdown: mdText,
    downloaded: 0,
    uploaded: 0,
    failed: 0,
    errors: [],
  };

  if (refs.length === 0) return result;

  let output = mdText;

  // Process in reverse order to preserve line numbers during replacement
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i];
    let localPath: string | null = null;

    try {
      // 1. Download
      localPath = downloadImage(ref.url);
      result.downloaded++;

      // 2. Upload to Feishu drive
      const token = uploadImage(localPath);
      result.uploaded++;

      // 3. Insert image block into document
      insertImageBlock(cli, docId, token);

      // 4. Remove image reference from markdown (it's now a block)
      const lines = output.split("\n");
      lines.splice(ref.line, 1);
      output = lines.join("\n");

    } catch (err) {
      result.failed++;
      result.errors.push(`${ref.url}: ${(err as Error).message}`);
    } finally {
      // Cleanup temp file
      if (localPath) {
        try { unlinkSync(localPath); } catch { /* ignore */ }
      }
    }
  }

  result.markdown = output;
  return result;
}

/**
 * Process images from a local directory.
 * Scans for ![alt](relative/path.png) references and resolves them.
 */
export function processLocalImages(
  cli: LarkCli,
  mdText: string,
  docId: string,
  imageDir: string
): ImageProcessResult {
  const refs = extractImageRefs(mdText);
  const result: ImageProcessResult = {
    markdown: mdText,
    downloaded: 0,
    uploaded: 0,
    failed: 0,
    errors: [],
  };

  if (refs.length === 0) return result;

  let output = mdText;

  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i];
    let localPath: string | null = null;

    try {
      // Resolve local path
      if (ref.url.startsWith("http")) {
        localPath = downloadImage(ref.url);
        result.downloaded++;
      } else {
        localPath = join(imageDir, ref.url);
        if (!existsSync(localPath)) {
          throw new Error(`Local image not found: ${localPath}`);
        }
      }

      // Upload
      const token = uploadImage(localPath);
      result.uploaded++;

      // Insert block
      insertImageBlock(cli, docId, token);

      // Remove from markdown
      const lines = output.split("\n");
      lines.splice(ref.line, 1);
      output = lines.join("\n");

    } catch (err) {
      result.failed++;
      result.errors.push(`${ref.url}: ${(err as Error).message}`);
    } finally {
      if (localPath && ref.url.startsWith("http")) {
        try { unlinkSync(localPath); } catch { /* ignore */ }
      }
    }
  }

  result.markdown = output;
  return result;
}
