/**
 * Browser-based image download for wiki sync.
 *
 * When copying docs across wiki spaces, the API media download returns 403.
 * This module downloads images via Playwright browser session using Feishu's
 * internal CDN, which uses session cookies for auth.
 *
 * Browser state is cached for headless reuse across sessions.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ImageData } from "../wiki/block-copy.js";

// ─── Types ──────────────────────────────────────────────────────────────

interface BrowserCtx {
  ctx: unknown;
  browser: unknown;
}

// ─── Browser State ──────────────────────────────────────────────────────

const DEFAULT_STATE_FILE = join(
  homedir(), ".config", "lark-hirono", "browser-state.json",
);

let _browserCtx: BrowserCtx | null = null;
let _browserFailed = false;

async function getBrowserContext(
  sourceNodeToken: string,
  stateFile: string,
): Promise<BrowserCtx> {
  if (_browserFailed) throw new Error("Browser previously failed to launch");
  if (_browserCtx) return _browserCtx;

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "playwright not installed. Run: npm install playwright && npx playwright install chromium",
    );
  }

  const hasState = existsSync(stateFile);

  if (hasState) {
    console.log("  [Browser] Using cached session…");
    try {
      const browser = await playwright.chromium.launch({ headless: true });
      const ctx = await browser.newContext({ storageState: stateFile });
      _browserCtx = { ctx, browser };
      return _browserCtx;
    } catch {
      console.log("  [Browser] Cached session invalid, need re-login");
    }
  }

  console.log("[Browser] Launching browser for Feishu login…");
  console.log("[Browser] Please log in, then images will download automatically.");
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: false });
  } catch (e) {
    _browserFailed = true;
    throw new Error(`Cannot launch browser (need display): ${(e as Error).message}`);
  }

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(
    `https://my.feishu.cn/wiki/${sourceNodeToken}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );

  for (let i = 0; i < 180; i++) {
    const url = page.url();
    if (!url.includes("passport") && !url.includes("login") && !url.includes("accounts")) {
      break;
    }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  const stateDir = stateFile.substring(0, stateFile.lastIndexOf("/"));
  mkdirSync(stateDir, { recursive: true });
  await ctx.storageState({ path: stateFile });
  console.log("  [Browser] Session saved.");

  _browserCtx = { ctx, browser };
  return _browserCtx;
}

export async function closeBrowser(): Promise<void> {
  if (_browserCtx) {
    try {
      await (_browserCtx.browser as { close(): Promise<void> }).close();
    } catch { /* ignore */ }
    _browserCtx = null;
  }
}

// ─── Image Download ─────────────────────────────────────────────────────

const CDN_BASE = "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/preview";

async function downloadImage(
  fileToken: string,
  sourceNodeToken: string,
  stateFile: string,
): Promise<Buffer> {
  const bc = await getBrowserContext(sourceNodeToken, stateFile);
  const ctx = bc.ctx as {
    request: {
      get(url: string, opts?: { timeout?: number }): Promise<{
        status(): number;
        body(): Promise<Buffer>;
      }>;
    };
  };

  const url = `${CDN_BASE}/${fileToken}/?preview_type=16`;
  const resp = await ctx.request.get(url, { timeout: 30_000 });
  const status = resp.status();

  if (status !== 200) {
    throw new Error(`Browser download failed [${status}]`);
  }
  const data = await resp.body();
  if (data.length < 100) {
    throw new Error(`Browser download too small [${data.length} bytes]`);
  }
  return data;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Pre-download all images from source blocks via browser session.
 * Returns an ImageCache map: { file_token → { bytes, width, height, align, scale } }
 */
export async function prefetchImages(
  sourceBlocks: Record<string, unknown>[],
  sourceNodeToken: string,
  opts?: { verbose?: boolean; browserState?: string },
): Promise<Map<string, ImageData>> {
  const cache = new Map<string, ImageData>();
  const stateFile = opts?.browserState ?? DEFAULT_STATE_FILE;

  // Collect image blocks with tokens
  const targets: Array<{ token: string; width: number; height: number; align: number; scale: number }> = [];
  for (const b of sourceBlocks) {
    if ((b.block_type as number) !== 27) continue;
    const img = b.image as Record<string, unknown> | undefined;
    const token = (img?.token as string) ?? "";
    if (token) {
      targets.push({
        token,
        width: (img?.width as number) ?? 0,
        height: (img?.height as number) ?? 0,
        align: (img?.align as number) ?? 0,
        scale: (img?.scale as number) ?? 1,
      });
    }
  }

  if (targets.length === 0) return cache;

  console.log(`  Downloading ${targets.length} images…`);

  for (const t of targets) {
    try {
      const bytes = await downloadImage(t.token, sourceNodeToken, stateFile);
      cache.set(t.token, {
        bytes,
        width: t.width,
        height: t.height,
        align: t.align,
        scale: t.scale,
      });
      if (opts?.verbose) {
        console.log(`    Downloaded ${t.token.slice(0, 12)}… (${bytes.length} bytes)`);
      }
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 80) ?? "";
      console.error(`    Image ${t.token.slice(0, 12)}… failed: ${msg}`);
    }
  }

  console.log(`  ${cache.size}/${targets.length} images downloaded`);
  return cache;
}
