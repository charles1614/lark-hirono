/**
 * Lark CLI wrapper — thin subprocess interface to `lark-cli`.
 *
 * Auth is handled entirely by the CLI (`lark-cli auth login`).
 * This module only calls the CLI binary and parses JSON output.
 */

import { execSync as execSyncShell, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// ─── CLI Discovery ──────────────────────────────────────────────────────

const CLI_CANDIDATES = [
  process.env.LARK_CLI,
  "/tmp/openclaw/larkcli/node_modules/.bin/lark-cli",
  "/usr/local/bin/lark-cli",
].filter(Boolean) as string[];

function resolveFromPath(): string | null {
  try {
    return execSyncShell("which lark-cli", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

const MIN_LARK_CLI_VERSION = "1.0.9";

export function findLarkCli(): string {
  for (const p of CLI_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  const fromPath = resolveFromPath();
  if (fromPath && existsSync(fromPath)) return fromPath;
  throw new Error(
    "lark-cli not found. Install with:\n" +
      "  mkdir -p /tmp/larkcli && cd /tmp/larkcli\n" +
      "  npm init -y && npm install @larksuite/cli\n" +
      "  node node_modules/@larksuite/cli/scripts/install.js\n" +
      "Or set LARK_CLI env var."
  );
}

/**
 * Check lark-cli version meets minimum requirement.
 * Returns the version string, or throws if too old.
 */
export function checkLarkCliVersion(cliPath: string): string {
  try {
    const out = execFileSync(cliPath, ["--version"], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // Output: "lark-cli version X.Y.Z"
    const match = out.match(/(\d+\.\d+\.\d+)/);
    if (!match) return "unknown";
    const version = match[1];
    const [maj, min, pat] = version.split(".").map(Number);
    const [rMaj, rMin, rPat] = MIN_LARK_CLI_VERSION.split(".").map(Number);
    if (maj < rMaj || (maj === rMaj && min < rMin) || (maj === rMaj && min === rMin && pat < rPat)) {
      throw new Error(
        `lark-cli ${version} is too old (requires >=${MIN_LARK_CLI_VERSION}). ` +
        `Update with: npm update -g @larksuite/cli`
      );
    }
    return version;
  } catch (err) {
    if ((err as Error).message?.includes("too old")) throw err;
    return "unknown";
  }
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface AuthStatus {
  appId: string;
  brand: string;
  identity: string;
  tokenStatus: "valid" | "needs_refresh" | "expired";
  userOpenId: string;
  userName: string;
  expiresAt: string;
  refreshExpiresAt: string;
  scope: string;
}

export interface ApiResult {
  code: number;
  msg: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CliOptions {
  cliPath?: string;
  timeout?: number;
  retries?: number;
}

// ─── Core ───────────────────────────────────────────────────────────────

export class LarkCli {
  private cli: string;
  private timeout: number;
  private retries: number;

  constructor(opts: CliOptions = {}) {
    this.cli = opts.cliPath ?? findLarkCli();
    this.timeout = opts.timeout ?? 60_000;
    this.retries = opts.retries ?? 1;
    checkLarkCliVersion(this.cli);
  }

  /** Run lark-cli and return parsed JSON. */
  private run(args: string[], timeout?: number, stdin?: string): ApiResult | null {
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const out = execFileSync(this.cli, args, {
          encoding: "utf-8",
          timeout: timeout ?? this.timeout,
          stdio: ["pipe", "pipe", "pipe"],
          input: stdin ?? undefined,
        });
        if (!out.trim()) return null;
        return JSON.parse(out) as ApiResult;
      } catch (err: any) {
        // EPIPE with valid output: CLI exited before stdin was fully consumed,
        // but output is still valid JSON. Parse and return it.
        if (err.code === "EPIPE" && err.stdout?.trim()) {
          try {
            const parsed = JSON.parse(err.stdout.trim());
            if (parsed?.ok || parsed?.code === 0 || parsed?.data) {
              return parsed as ApiResult;
            }
          } catch { /* fall through */ }
        }

        // Retry on transient errors
        if (attempt < this.retries - 1) {
          const delay = 1000 * (attempt + 1);
          execSyncShell(`sleep ${delay / 1000}`);
          continue;
        }
        throw err;
      }
    }
    return null;
  }

  // ─── Auth ───────────────────────────────────────────────────────────

  /** Get current auth status. Throws if not logged in. */
  status(): AuthStatus {
    const result = this.run(["auth", "status"]);
    if (!result || !result.userOpenId) {
      throw new Error("Not logged in. Run: lark-cli auth login --domain docs");
    }
    return result as unknown as AuthStatus;
  }

  // ─── API Calls ─────────────────────────────────────────────────────

  /** Generic GET request. */
  get(path: string, params?: Record<string, unknown>): ApiResult | null {
    const args = ["api", "GET", path];
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        args.push(`--params`, JSON.stringify({ [k]: v }));
      }
    }
    return this.run(args, 60_000);
  }

  /** Generic PATCH request. */
  patch(path: string, data: Record<string, unknown>): ApiResult | null {
    return this.run(["api", "PATCH", path, "--data", JSON.stringify(data)], 30_000);
  }

  /** Update a section by title using replace_range mode. */
  updateSection(docId: string, sectionTitle: string, markdown: string): boolean {
    try {
      const args = [
        "docs",
        "+update",
        "--doc", docId,
        "--mode", "replace_range",
        "--selection-by-title", sectionTitle,
        "--markdown", markdown,
      ];
      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsed = JSON.parse(out);
      return parsed?.ok === true || parsed?.code === 0;
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 200) ?? "unknown error";
      console.error(`updateSection error: ${msg}`);
      return false;
    }
  }
  appendDoc(docId: string, markdown: string, imageDir?: string): boolean {
    try {
      const args = [
        "docs",
        "+update",
        "--doc", docId,
        "--mode", "append",
        "--markdown", markdown,
      ];
      if (imageDir) {
        args.push("--image-dir", imageDir);
      }
      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      const parsed = JSON.parse(out);
      return parsed?.ok === true || parsed?.code === 0;
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 200) ?? "unknown error";
      console.error(`appendDoc error: ${msg}`);
      return false;
    }
  }

  /** Generic POST request. */
  post(path: string, data?: Record<string, unknown>): ApiResult | null {
    const args = ["api", "POST", path];
    if (data) args.push("--data", JSON.stringify(data));
    return this.run(args);
  }

  // ─── Doc Shortcuts ─────────────────────────────────────────────────

  /** Create a doc via the CLI's built-in shortcut. */
  createDoc(
    title: string,
    markdown: string,
    wikiSpace = "7620053427331681234",
    wikiNode?: string,
    imageDir?: string
  ): { doc_id: string; url: string; boardTokens: string[] } | null {
    try {
      const args = ["docs", "+create", "--title", title, "--markdown", markdown];
      if (wikiNode) {
        args.push("--wiki-node", wikiNode);
      } else if (wikiSpace) {
        args.push("--wiki-space", wikiSpace);
      }
      if (imageDir) {
        args.push("--image-dir", imageDir);
      }

      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsed = JSON.parse(out);
      if (parsed?.ok && parsed.data) {
        const docId = parsed.data.doc_id as string;
        const docUrl = (parsed.data.doc_url as string) ?? `https://www.feishu.cn/wiki/${docId}`;
        const boardTokens = (parsed.data.board_tokens as string[]) ?? [];
        if (docId) return { doc_id: docId, url: docUrl, boardTokens };
      }
      return null;
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 200) ?? "unknown error";
      console.error(`createDoc error: ${msg}`);
      return null;
    }
  }

  /** Get all blocks in a document. Paginates with small page_size to avoid ENOBUFS. */
  getBlocks(docId: string): Record<string, unknown>[] {
    const allItems: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    const pageSize = 50; // small pages to avoid ENOBUFS/timeout on large docs

    do {
      const params: Record<string, unknown> = { page_size: pageSize };
      if (pageToken) params.page_token = pageToken;

      const result = this.run([
        "api", "GET",
        `/open-apis/docx/v1/documents/${docId}/blocks`,
        "--params", JSON.stringify(params),
      ], 120_000);

      if (!result?.data) break;

      const data = result.data as any;
      const items = data.items ?? [];
      allItems.push(...items);

      if (data.has_more && data.page_token) {
        pageToken = data.page_token;
      } else {
        break;
      }
    } while (pageToken);

    return allItems;
  }

  /** Delete a range of children from a block (batch_delete). Used for cleanup. */
  deleteBlockChildrenTail(
    docId: string,
    parentBlockId: string,
    startIndex: number,
    endIndex: number
  ): boolean {
    const path = `/open-apis/docx/v1/documents/${docId}/blocks/${parentBlockId}/children/batch_delete`;
    const result = this.run(["api", "DELETE", path, "--data", JSON.stringify({ start_index: startIndex, end_index: endIndex })], 30_000);
    return result !== null && result.code === 0;
  }

  /** Insert block children at a given index. */
  createBlockChildren(
    docId: string,
    parentBlockId: string,
    children: Record<string, unknown>[],
    index: number
  ): boolean {
    const path = `/open-apis/docx/v1/documents/${docId}/blocks/${parentBlockId}/children`;
    const result = this.post(path, { children, index });
    return result !== null && result.code === 0;
  }

  /** Insert block children and return the created blocks with their new IDs. */
  createBlockChildrenEx(
    docId: string,
    parentBlockId: string,
    children: Record<string, unknown>[],
    index: number
  ): Record<string, unknown>[] | null {
    const path = `/open-apis/docx/v1/documents/${docId}/blocks/${parentBlockId}/children`;
    const result = this.post(path, { children, index });
    if (!result || result.code !== 0) return null;
    const data = result.data as Record<string, unknown> | undefined;
    return (data?.children as Record<string, unknown>[]) ?? null;
  }

  /** Fetch a single block by ID. */
  getBlock(docId: string, blockId: string): Record<string, unknown> | null {
    const result = this.run([
      "api", "GET",
      `/open-apis/docx/v1/documents/${docId}/blocks/${blockId}`,
    ], 30_000);
    if (!result?.data) return null;
    return (result.data as Record<string, unknown>).block as Record<string, unknown> | null;
  }

  /** PATCH a block with arbitrary payload. */
  patchBlock(
    docId: string,
    blockId: string,
    payload: Record<string, unknown>,
    timeout = 60_000
  ): boolean {
    const path = `/open-apis/docx/v1/documents/${docId}/blocks/${blockId}?document_revision_id=-1`;
    const result = this.run(["api", "PATCH", path, "--data", JSON.stringify(payload)], timeout);
    return result !== null && result.code === 0;
  }

  
  /** Replace doc content with new markdown. */
  updateDoc(docId: string, markdown: string, imageDir?: string): { ok: boolean; boardTokens: string[] } {
    try {
      const args = [
        "docs", "+update",
        "--doc", docId,
        "--mode", "overwrite",
        "--markdown", markdown,
      ];
      if (imageDir) {
        args.push("--image-dir", imageDir);
      }
      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      const parsed = JSON.parse(out);
      const boardTokens = (parsed?.data?.board_tokens as string[]) ?? [];
      return { ok: parsed?.ok === true || parsed?.success === true, boardTokens };
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 200) ?? "unknown error";
      console.error(`updateDoc error: ${msg}`);
      return { ok: false, boardTokens: [] };
    }
  }

  /**
   * Overwrite a whiteboard with content.
   * @param format - "raw" for DSL JSON, "mermaid" for mermaid source
   */
  updateWhiteboard(boardToken: string, content: string, format: "raw" | "mermaid" = "raw"): boolean {
    try {
      const args = [
        "docs", "+whiteboard-update",
        "--whiteboard-token", boardToken,
        "--input_format", format,
        "--source", "-",
        "--overwrite",
        "--yes",
        "--as", "user",
      ];
      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        input: content,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const parsed = JSON.parse(out);
      return parsed?.ok === true;
    } catch (err) {
      const stderr = (err as any).stderr?.toString?.()?.slice(0, 300) ?? "";
      if (stderr) console.error(`updateWhiteboard stderr: ${stderr}`);
      return false;
    }
  }

  /** Query whiteboard content as raw DSL JSON. */
  queryWhiteboard(boardToken: string): object | null {
    try {
      const out = execFileSync(this.cli, [
        "whiteboard", "+query",
        "--whiteboard-token", boardToken,
        "--output_as", "raw",
        "--as", "user",
      ], {
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const parsed = JSON.parse(out);
      if (parsed?.ok && parsed.data?.nodes) return parsed.data;
      return null;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      // Log stderr if available (lark-cli writes errors there)
      const stderr = (err as any).stderr?.toString?.()?.slice(0, 300) ?? "";
      if (stderr) console.error(`queryWhiteboard stderr: ${stderr}`);
      else console.error(`queryWhiteboard error: ${msg.slice(0, 200)}`);
      return null;
    }
  }
  /** Fetch doc content as markdown. Parses JSON stdout from lark-cli. */
  fetchDoc(docId: string): string | null {
    try {
      const out = execFileSync(this.cli, [
        "docs", "+fetch", "--doc", docId,
      ], {
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const parsed = JSON.parse(out);
      if (parsed?.data?.markdown) return parsed.data.markdown;
      return null;
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 200) ?? "unknown error";
      console.error(`fetchDoc error: ${msg}`);
      return null;
    }
  }
}
