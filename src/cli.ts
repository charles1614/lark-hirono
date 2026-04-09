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
    } catch {
      return false;
    }
  }
  appendDoc(docId: string, markdown: string): boolean {
    try {
      const args = [
        "docs",
        "+update",
        "--doc", docId,
        "--mode", "append",
        "--markdown", markdown,
      ];
      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      const parsed = JSON.parse(out);
      return parsed?.ok === true || parsed?.code === 0;
    } catch {
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
    wikiNode?: string
  ): { doc_id: string; url: string; boardTokens: string[] } | null {
    try {
      const args = ["docs", "+create", "--title", title, "--markdown", markdown];
      if (wikiNode) {
        args.push("--wiki-node", wikiNode);
      } else if (wikiSpace) {
        args.push("--wiki-space", wikiSpace);
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
    } catch {
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

  /** PATCH a block with arbitrary payload. */
  patchBlock(
    docId: string,
    blockId: string,
    payload: Record<string, unknown>
  ): boolean {
    const path = `/open-apis/docx/v1/documents/${docId}/blocks/${blockId}?document_revision_id=-1`;
    const result = this.patch(path, payload);
    return result !== null && result.code === 0;
  }

  
  /** Replace doc content with new markdown. */
  updateDoc(docId: string, markdown: string): { ok: boolean; boardTokens: string[] } {
    try {
      const args = [
        "docs", "+update",
        "--doc", docId,
        "--mode", "overwrite",
        "--markdown", markdown,
      ];
      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      const parsed = JSON.parse(out);
      const boardTokens = (parsed?.data?.board_tokens as string[]) ?? [];
      return { ok: parsed?.ok === true || parsed?.success === true, boardTokens };
    } catch {
      return { ok: false, boardTokens: [] };
    }
  }

  /** Overwrite a whiteboard's DSL content. dslJson is the full whiteboard-cli OpenAPI output. */
  updateWhiteboard(boardToken: string, dslJson: string): boolean {
    try {
      const args = [
        "docs", "+whiteboard-update",
        "--whiteboard-token", boardToken,
        "--overwrite",
        "--yes",
      ];
      const out = execFileSync(this.cli, args, {
        encoding: "utf-8",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        input: dslJson,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const parsed = JSON.parse(out);
      return parsed?.ok === true;
    } catch {
      return false;
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
    } catch {
      return null;
    }
  }
}
