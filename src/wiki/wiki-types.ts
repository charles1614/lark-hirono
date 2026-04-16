/**
 * Shared types for wiki sync operations.
 */

import type { FailedImage } from "./block-copy.js";

export interface WikiNode {
  nodeToken: string;
  objToken: string;
  objType: string;
  title: string;
  hasChild: boolean;
  spaceId: string;
  parentNodeToken: string;
  nodeType: string;
  objEditTime: string;
}

export interface SyncNodeResult {
  sourceToken: string;
  targetToken: string | null;
  title: string;
  strategy: "server-copy" | "block-copy" | "skipped" | "updated" | "unchanged";
  ok: boolean;
  error?: string;
  /** Unsupported block types encountered: block_type → count */
  unsupportedTypes?: Map<number, number>;
  /** Images that failed to download or upload */
  failedImages?: FailedImage[];
  children: SyncNodeResult[];
}

export interface SyncOptions {
  dryRun: boolean;
  verbose: boolean;
  headingNumbers: boolean;
  browserState?: string;
}
