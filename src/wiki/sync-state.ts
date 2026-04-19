/**
 * Sync state persistence — tracks source→target mapping between incremental syncs.
 *
 * State is stored as JSON at ~/.config/lark-hirono/sync-state/<hash>.json
 * where <hash> is derived from the source+target node tokens.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Types ──────────────────────────────────────────────────────────────

export interface SyncState {
  version: 1;
  sourceRoot: string;
  targetRoot: string;
  lastSyncTime: string;
  rootContentHash: string;
  /** objEditTime of the root node at last sync, for fast change detection */
  rootObjEditTime?: string;
  /**
   * True once a full sync (tree copy + fixupReferences) has completed at
   * least once. Absent/false means a prior run was interrupted; the next
   * run must force fixupReferences and skip orphan pruning.
   */
  firstRunComplete?: boolean;
  pages: Record<string, PageState>;
}

export interface PageState {
  targetNodeToken: string;
  targetObjToken: string;
  sourceObjToken: string;
  title: string;
  objEditTime: string;
  contentHash: string;
  lastSynced: string;
  /** Source image tokens that failed to sync (absent if all succeeded) */
  failedImages?: string[];
}

// ─── Paths ──────────────────────────────────────────────────────────────

const STATE_DIR = join(homedir(), ".config", "lark-hirono", "sync-state");

function stateHash(srcToken: string, dstToken: string): string {
  return createHash("sha256")
    .update(`${srcToken}:${dstToken}`)
    .digest("hex")
    .slice(0, 16);
}

export function stateFilePath(srcToken: string, dstToken: string): string {
  return join(STATE_DIR, `${stateHash(srcToken, dstToken)}.json`);
}

// ─── Load / Save ────────────────────────────────────────────────────────

export function loadState(srcToken: string, dstToken: string): SyncState | null {
  const path = stateFilePath(srcToken, dstToken);
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.version !== 1) return null;
    return data as unknown as SyncState;
  } catch {
    return null;
  }
}

export function saveState(state: SyncState): void {
  const path = stateFilePath(state.sourceRoot, state.targetRoot);
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

// ─── Content Hashing ────────────────────────────────────────────────────

/** Fields to strip before hashing — these change between copies. */
const STRIP_KEYS = new Set(["block_id", "parent_id", "children", "comment_ids"]);

function stripBlock(block: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(block)) {
    if (STRIP_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Compute a SHA-256 hash of block content, ignoring positional/identity fields.
 * Used to detect whether document content actually changed (vs metadata-only edits).
 */
export function computeContentHash(blocks: Record<string, unknown>[]): string {
  const stripped = blocks
    .filter((b) => (b.block_type as number) !== 1) // skip root page block
    .map(stripBlock);
  return createHash("sha256")
    .update(JSON.stringify(stripped))
    .digest("hex");
}

// ─── State Builder ──────────────────────────────────────────────────────

/**
 * Create an initial SyncState from a completed first-run sync.
 */
export function buildInitialState(
  sourceRoot: string,
  targetRoot: string,
  rootContentHash: string,
  rootObjEditTime?: string,
): SyncState {
  return {
    version: 1,
    sourceRoot,
    targetRoot,
    lastSyncTime: new Date().toISOString(),
    rootContentHash,
    rootObjEditTime: rootObjEditTime ?? "",
    firstRunComplete: false,
    pages: {},
  };
}
