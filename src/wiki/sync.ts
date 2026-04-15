/**
 * Wiki sync — recursively copy a wiki subtree to a target location.
 *
 * Primary: server-side copy via `wiki nodes copy` (fast, same-space).
 * Fallback: block-level copy (preserves ALL styles including images).
 */

import { execSync } from "node:child_process";
import { copyDocBlocks, cleanupEmptyTails, computeHeadingNumbers } from "./block-copy.js";
import { prefetchImages, closeBrowser } from "../browser/image-transfer.js";
import type { RefMaps } from "./fix-refs.js";
import type { WikiClient } from "./wiki-client.js";
import type { WikiNode, SyncNodeResult, SyncOptions } from "./wiki-types.js";

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Recursively sync a wiki subtree from source to target.
 */
export async function syncTree(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  targetParentToken: string,
  targetSpaceId: string,
  opts: SyncOptions,
  refs?: RefMaps,
): Promise<SyncNodeResult[]> {
  const children = wikiClient.listChildren(
    sourceNode.spaceId,
    sourceNode.nodeToken,
  );

  if (children.length === 0) {
    if (opts.verbose) console.log("  (no children)");
    return [];
  }

  const results: SyncNodeResult[] = [];
  const total = children.length;

  try {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const prefix = `[${i + 1}/${total}]`;

      if (opts.dryRun) {
        printDryRunNode(child, prefix);
        if (child.hasChild) {
          const subResults = await syncTree(
            wikiClient, child, "", targetSpaceId, opts, refs,
          );
          results.push({
            sourceToken: child.nodeToken, targetToken: null,
            title: child.title, strategy: "skipped", ok: true, children: subResults,
          });
        } else {
          results.push({
            sourceToken: child.nodeToken, targetToken: null,
            title: child.title, strategy: "skipped", ok: true, children: [],
          });
        }
        continue;
      }

      const result = await syncNode(
        wikiClient, child, targetParentToken, targetSpaceId, opts, prefix, refs,
      );
      results.push(result);
      sleep(500);
    }
  } finally {
    await closeBrowser();
  }

  return results;
}

/**
 * Print the source tree in dry-run mode.
 */
export function printTree(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  indent = 0,
): void {
  const pad = "  ".repeat(indent);
  const type = sourceNode.objType || "node";
  const childMark = sourceNode.hasChild ? " [+]" : "";
  console.log(`${pad}- ${sourceNode.title} (${type})${childMark}`);

  if (sourceNode.hasChild) {
    const children = wikiClient.listChildren(
      sourceNode.spaceId,
      sourceNode.nodeToken,
    );
    for (const child of children) {
      printTree(wikiClient, child, indent + 1);
    }
  }
}

// ─── Internal ───────────────────────────────────────────────────────────

async function syncNode(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  targetParentToken: string,
  targetSpaceId: string,
  opts: SyncOptions,
  prefix: string,
  refs?: RefMaps,
): Promise<SyncNodeResult> {
  console.log(`${prefix} Copying: "${sourceNode.title}" (${sourceNode.objType || "node"})…`);

  if (sourceNode.nodeType === "shortcut") {
    console.log(`${prefix}   Skipped (shortcut)`);
    return {
      sourceToken: sourceNode.nodeToken, targetToken: null,
      title: sourceNode.title, strategy: "skipped", ok: true, children: [],
    };
  }

  // ── Strategy 1: server-side copy (fast, same-space) ───────────────
  const copied = wikiClient.copyNode(
    sourceNode.spaceId, sourceNode.nodeToken, targetParentToken,
  );

  if (copied) {
    console.log(`${prefix}   OK (server-copy) → ${copied.nodeToken}`);
    return {
      sourceToken: sourceNode.nodeToken, targetToken: copied.nodeToken,
      title: sourceNode.title, strategy: "server-copy", ok: true, children: [],
    };
  }

  // ── Strategy 2: block-level copy (preserves all styles) ───────────
  if (sourceNode.objType !== "docx") {
    const placeholder = wikiClient.createNode(
      targetSpaceId, targetParentToken, sourceNode.title, "docx",
    );
    const pToken = placeholder?.nodeToken ?? null;
    if (pToken) {
      console.log(`${prefix}   Created placeholder → ${pToken}`);
    } else {
      console.error(`${prefix}   FAIL: could not create placeholder`);
    }
    const childResults = sourceNode.hasChild && pToken
      ? await syncTree(wikiClient, sourceNode, pToken, targetSpaceId, opts, refs)
      : [];
    return {
      sourceToken: sourceNode.nodeToken, targetToken: pToken,
      title: sourceNode.title, strategy: "block-copy",
      ok: pToken !== null, error: pToken ? undefined : "Failed to create placeholder",
      children: childResults,
    };
  }

  // Create target wiki node
  const newNode = wikiClient.createNode(
    targetSpaceId, targetParentToken, sourceNode.title,
  );
  if (!newNode) {
    console.error(`${prefix}   FAIL: could not create target node`);
    return {
      sourceToken: sourceNode.nodeToken, targetToken: null,
      title: sourceNode.title, strategy: "block-copy",
      ok: false, error: "Failed to create target node", children: [],
    };
  }

  const targetObjToken = newNode.objToken;
  console.log(`${prefix}   Created node → ${newNode.nodeToken}`);

  // Populate reference maps for post-copy fixup
  if (refs) {
    refs.nodeMap.set(sourceNode.nodeToken, newNode.nodeToken);
    refs.objMap.set(sourceNode.objToken, targetObjToken);
    refs.docMap.set(newNode.nodeToken, targetObjToken);
  }

  // Fetch source blocks
  const sourceBlocks = wikiClient.cli.getBlocks(sourceNode.objToken);
  if (sourceBlocks.length === 0) {
    console.error(`${prefix}   FAIL: no blocks in source document`);
    return {
      sourceToken: sourceNode.nodeToken, targetToken: newNode.nodeToken,
      title: sourceNode.title, strategy: "block-copy",
      ok: false, error: "No source blocks", children: [],
    };
  }
  if (opts.verbose) console.log(`${prefix}   ${sourceBlocks.length} blocks`);

  // Pre-download images via browser
  const imageCache = await prefetchImages(sourceBlocks, sourceNode.nodeToken, {
    verbose: opts.verbose,
    browserState: opts.browserState,
  });

  // Compute heading numbers if requested
  const headingNumbers = opts.headingNumbers
    ? computeHeadingNumbers(sourceBlocks)
    : undefined;

  // BFS block copy
  const result = copyDocBlocks(
    wikiClient.cli, sourceBlocks, targetObjToken, imageCache,
    { verbose: opts.verbose, headingNumbers },
  );
  console.log(`${prefix}   ${result.created} blocks created`);
  if (result.skipped > 0) {
    console.log(`${prefix}   ${result.skipped} blocks skipped`);
  }

  // Cleanup auto-created empty tails
  try {
    const cleaned = cleanupEmptyTails(wikiClient.cli, targetObjToken, sourceBlocks);
    if (cleaned > 0 && opts.verbose) {
      console.log(`${prefix}   Cleaned ${cleaned} empty tail(s)`);
    }
  } catch { /* ignore */ }

  // Recurse into children
  const childResults = sourceNode.hasChild
    ? await syncTree(wikiClient, sourceNode, newNode.nodeToken, targetSpaceId, opts, refs)
    : [];

  console.log(`${prefix}   OK (block-copy)`);
  return {
    sourceToken: sourceNode.nodeToken, targetToken: newNode.nodeToken,
    title: sourceNode.title, strategy: "block-copy", ok: true,
    children: childResults,
  };
}

function printDryRunNode(node: WikiNode, prefix: string): void {
  const type = node.objType || "node";
  const childMark = node.hasChild ? " [has children]" : "";
  const shortcut = node.nodeType === "shortcut" ? " (shortcut)" : "";
  console.log(`${prefix} ${node.title} (${type})${childMark}${shortcut}`);
}

function sleep(ms: number): void {
  execSync(`sleep ${ms / 1000}`);
}

// ─── Summary ────────────────────────────────────────────────────────────

export function printSummary(results: SyncNodeResult[]): void {
  let copied = 0;
  let blockCopy = 0;
  let skipped = 0;
  let failed = 0;

  function count(list: SyncNodeResult[]): void {
    for (const r of list) {
      if (!r.ok) failed++;
      else if (r.strategy === "server-copy") copied++;
      else if (r.strategy === "block-copy") blockCopy++;
      else skipped++;
      count(r.children);
    }
  }
  count(results);

  console.log("\n── Sync Summary ──");
  if (copied > 0) console.log(`  Server-copied: ${copied}`);
  if (blockCopy > 0) console.log(`  Block-copied:  ${blockCopy}`);
  if (skipped > 0) console.log(`  Skipped:       ${skipped}`);
  if (failed > 0) console.log(`  Failed:        ${failed}`);
  console.log(`  Total:         ${copied + blockCopy + skipped + failed}`);
}
