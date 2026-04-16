/**
 * Wiki API client — wraps lark-cli wiki subcommands.
 *
 * Uses execFileSync directly (same pattern as commands/auth.ts)
 * for wiki-specific operations. Takes a LarkCli instance for
 * doc-level operations (getBlocks, createBlockChildren, patchBlock).
 */

import { execFileSync } from "node:child_process";
import { findLarkCli, type LarkCli } from "../cli.js";
import type { WikiNode } from "./wiki-types.js";

export class WikiClient {
  private cliPath: string;

  constructor(public readonly cli: LarkCli) {
    this.cliPath = findLarkCli();
  }

  // ─── Node Metadata ──────────────────────────────────────────────────

  /** Resolve a node token to full metadata (including space_id). */
  getNode(token: string): WikiNode | null {
    const result = this.exec([
      "wiki", "spaces", "get_node",
      "--params", JSON.stringify({ token }),
    ]);
    if (!result?.data) return null;
    const n = (result.data as Record<string, unknown>).node as
      | Record<string, unknown>
      | undefined;
    if (!n) return null;
    return mapNode(n);
  }

  // ─── Children ───────────────────────────────────────────────────────

  /** List all direct children of a node (handles pagination via --page-all). */
  listChildren(spaceId: string, parentNodeToken: string): WikiNode[] {
    const result = this.exec([
      "wiki", "nodes", "list",
      "--params", JSON.stringify({
        space_id: spaceId,
        parent_node_token: parentNodeToken,
        page_size: 50,
      }),
      "--page-all",
      "--page-limit", "0",
    ], 120_000);

    if (!result?.data) return [];
    const items = (result.data as Record<string, unknown>).items;
    if (!Array.isArray(items)) return [];
    return items.map((item) => mapNode(item as Record<string, unknown>));
  }

  // ─── Copy ───────────────────────────────────────────────────────────

  /**
   * Server-side deep copy of a node (including entire subtree).
   * Preserves all block-level styles natively.
   */
  copyNode(
    spaceId: string,
    nodeToken: string,
    targetParentToken: string,
    title?: string,
  ): WikiNode | null {
    const data: Record<string, string> = {
      target_parent_token: targetParentToken,
    };
    if (title) data.title = title;

    const result = this.exec([
      "wiki", "nodes", "copy",
      "--params", JSON.stringify({ space_id: spaceId, node_token: nodeToken }),
      "--data", JSON.stringify(data),
    ], 120_000);

    if (!result?.data) return null;
    const n = (result.data as Record<string, unknown>).node as
      | Record<string, unknown>
      | undefined;
    if (!n) return null;
    return mapNode(n);
  }

  // ─── Create ─────────────────────────────────────────────────────────

  /** Create an empty wiki node. */
  createNode(
    spaceId: string,
    parentNodeToken: string,
    title: string,
    objType = "docx",
  ): WikiNode | null {
    const result = this.exec([
      "wiki", "+node-create",
      "--space-id", spaceId,
      "--parent-node-token", parentNodeToken,
      "--title", title,
      "--obj-type", objType,
    ]);

    if (!result?.data) return null;
    const data = result.data as Record<string, unknown>;
    // +node-create returns fields at top level or nested under .node
    const n = (data.node as Record<string, unknown> | undefined) ?? data;
    if (!n.node_token) return null;
    return mapNode(n);
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private exec(
    args: string[],
    timeout = 60_000,
  ): { code?: number; data?: Record<string, unknown> } | null {
    try {
      const out = execFileSync(this.cliPath, args, {
        encoding: "utf-8",
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (!out.trim()) return null;
      return JSON.parse(out) as { code?: number; data?: Record<string, unknown> };
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 200) ?? "unknown error";
      console.error(`wiki-client error: ${msg}`);
      return null;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function mapNode(n: Record<string, unknown>): WikiNode {
  return {
    nodeToken: (n.node_token as string) ?? "",
    objToken: (n.obj_token as string) ?? "",
    objType: (n.obj_type as string) ?? "",
    title: (n.title as string) ?? "",
    hasChild: Boolean(n.has_child),
    spaceId: (n.space_id as string) ?? "",
    parentNodeToken: (n.parent_node_token as string) ?? "",
    nodeType: (n.node_type as string) ?? "origin",
    objEditTime: (n.obj_edit_time as string) ?? "",
  };
}
