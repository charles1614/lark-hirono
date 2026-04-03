/**
 * Lark CLI wrapper — thin subprocess interface to `lark-cli`.
 *
 * Auth is handled entirely by the CLI (`lark-cli auth login`).
 * This module only calls the CLI binary and parses JSON output.
 */

import { execSync as execSyncShell, execFileSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, mkdtempSync, rmdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── CLI Discovery ──────────────────────────────────────────────────────

const CLI_CANDIDATES = [
  process.env.LARK_CLI,
  "/tmp/openclaw/larkcli/node_modules/.bin/lark-cli",
  "/usr/local/bin/lark-cli",
].filter(Boolean) as string[];

export function findLarkCli(): string {
  for (const p of CLI_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "lark-cli not found. Install with:\n" +
      "  mkdir /tmp/larkcli && cd /tmp/larkcli\n" +
      "  pnpm init && pnpm add @larksuite/cli\n" +
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
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
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
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        const parsed = JSON.parse(out);
        return parsed?.ok === true || parsed?.code === 0;
      } catch {
        // Retry on failure
      }
    }
    return false;
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
  ): { doc_id: string; url: string } | null {
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
        if (docId) return { doc_id: docId, url: docUrl };
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

  /** Fetch doc content as markdown. */
  fetchDoc(docId: string): string | null {
    const result = this.run(["docs", "+fetch", "--doc", docId]);
    if (result && typeof result.data === "object") {
      return (result.data as any).markdown ?? null;
    }
    return null;
  }
}
