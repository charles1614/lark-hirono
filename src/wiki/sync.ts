/**
 * Wiki sync — recursively copy a wiki subtree to a target location.
 *
 * Primary: server-side copy via `wiki nodes copy` (fast, same-space).
 * Fallback: block-level copy (preserves ALL styles including images).
 */

import { execSync } from "node:child_process";
import { copyDocBlocks, cleanupEmptyTails, clearDocContent, computeHeadingNumbers, BLOCK_TYPE_NAME, type FailedImage } from "./block-copy.js";
import { prefetchImages } from "../browser/image-transfer.js";
import { computeContentHash, type SyncState, type PageState } from "./sync-state.js";
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
  onTargetCreated?: (info: TargetCreatedInfo) => void,
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
      onTargetCreated,
    );
    results.push(result);
    sleep(500);
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

/**
 * Copy the source node's page content into the target node (mirror semantics).
 * Clears existing target content, then block-copies from source.
 */
export async function syncRootContent(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  targetNode: WikiNode,
  opts: SyncOptions,
  refs?: RefMaps,
): Promise<{ ok: boolean; created: number; failedImages: FailedImage[] }> {
  if (sourceNode.objType !== "docx") {
    if (opts.verbose) console.log("  Root is not docx — skipping content sync");
    return { ok: true, created: 0, failedImages: [] };
  }

  const cli = wikiClient.cli;

  // Fetch source blocks
  const sourceBlocks = cli.getBlocks(sourceNode.objToken);
  if (sourceBlocks.length === 0) {
    if (opts.verbose) console.log("  Root has no blocks — skipping content sync");
    return { ok: true, created: 0, failedImages: [] };
  }

  // Check if source has any real content (beyond the root block itself)
  const root = sourceBlocks.find((b) => (b.block_type as number) === 1);
  const rootChildren = (root?.children as string[]) ?? [];
  if (rootChildren.length === 0) {
    if (opts.verbose) console.log("  Root page is empty — skipping content sync");
    return { ok: true, created: 0, failedImages: [] };
  }

  console.log(`  Syncing root page content (${sourceBlocks.length} blocks)…`);

  // Clear target content
  clearDocContent(cli, targetNode.objToken);

  // Pre-download images
  const imageCache = await prefetchImages(sourceBlocks, sourceNode.nodeToken, {
    verbose: opts.verbose,
    browserState: opts.browserState,
  });

  // Compute heading numbers if requested
  const headingNumbers = opts.headingNumbers
    ? computeHeadingNumbers(sourceBlocks)
    : undefined;

  // BFS block copy into target
  const result = copyDocBlocks(
    cli, sourceBlocks, targetNode.objToken, imageCache,
    { verbose: opts.verbose, headingNumbers },
  );
  console.log(`  Root content: ${result.created} blocks created`);
  if (result.failedImages.length > 0) {
    console.error(`  WARNING: ${result.failedImages.length} image(s) failed in root page`);
    for (const f of result.failedImages) {
      console.error(`    - ${f.sourceToken.slice(0, 12)}…: ${f.reason}`);
    }
  }

  // Cleanup auto-created empty tails
  try {
    cleanupEmptyTails(cli, targetNode.objToken, sourceBlocks);
  } catch { /* ignore */ }

  // Record refs for link fixup
  if (refs) {
    refs.nodeMap.set(sourceNode.nodeToken, targetNode.nodeToken);
    refs.objMap.set(sourceNode.objToken, targetNode.objToken);
    refs.docMap.set(targetNode.nodeToken, targetNode.objToken);
  }

  return { ok: true, created: result.created, failedImages: result.failedImages };
}

/**
 * Incremental sync — only create new nodes and update modified ones.
 * Compares source tree against saved state to skip unchanged pages.
 *
 * `visited` accumulates every source nodeToken seen this run; the caller
 * uses it after the top-level call to detect orphans in state.pages.
 */
export async function syncTreeIncremental(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  targetNode: WikiNode,
  state: SyncState,
  opts: SyncOptions,
  refs?: RefMaps,
  onProgress?: () => void,
  visited?: Set<string>,
  rootFailedImagesOut?: FailedImage[],
  presentTargets?: Set<string>,
): Promise<SyncNodeResult[]> {
  const cli = wikiClient.cli;

  // ── Root content check ──────────────────────────────────────────────
  if (sourceNode.objType === "docx") {
    // Always populate root refs so fixupReferences can rewrite links to/from the root
    if (refs) {
      refs.nodeMap.set(sourceNode.nodeToken, targetNode.nodeToken);
      refs.objMap.set(sourceNode.objToken, targetNode.objToken);
    }

    const rootChanged = sourceNode.objEditTime !== "" &&
      sourceNode.objEditTime !== (state.rootObjEditTime ?? "");

    if (rootChanged || state.rootContentHash === "") {
      const sourceBlocks = cli.getBlocks(sourceNode.objToken);
      const hash = computeContentHash(sourceBlocks);

      if (hash !== state.rootContentHash) {
        console.log("  Root page content changed — updating…");
        const rootResult = await syncRootContent(wikiClient, sourceNode, targetNode, opts, refs);
        if (rootFailedImagesOut) {
          for (const f of rootResult.failedImages) rootFailedImagesOut.push(f);
        }
        state.rootContentHash = hash;
        onProgress?.();
      } else if (opts.verbose) {
        console.log("  Root page: metadata changed but content identical — skipping");
      }
      state.rootObjEditTime = sourceNode.objEditTime;
    } else if (opts.verbose) {
      console.log("  Root page unchanged — skipping");
    }
  }

  // ── Children scan & classify ────────────────────────────────────────
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

  // Shared helper: run a child through the NEW-branch pipeline (full syncNode
  // with pre-register callback + final state recording). Used both for
  // genuinely new children and for heal-on-missing in the MOD path.
  const runAsNew = async (child: WikiNode, prefix: string): Promise<SyncNodeResult> => {
    const result = await syncNode(
      wikiClient, child, targetNode.nodeToken, targetNode.spaceId, opts, prefix, refs,
      (info) => {
        // Pre-register: write a placeholder entry to state the moment the
        // target node is created, before block copy starts. A kill during
        // block copy leaves contentHash="" so the next run re-enters the
        // MOD path (clear + recopy) into the same target node.
        state.pages[info.sourceToken] = {
          targetNodeToken: info.targetNodeToken,
          targetObjToken: info.targetObjToken,
          sourceObjToken: info.sourceObjToken,
          title: info.title,
          objEditTime: "",
          contentHash: "",
          lastSynced: new Date().toISOString(),
        };
        visited?.add(info.sourceToken);
        onProgress?.();
      },
    );
    if (result.ok && result.targetToken) {
      const emptyRefs: RefMaps = { nodeMap: new Map(), objMap: new Map(), docMap: new Map() };
      recordResultsInState(state, [result], refs ?? emptyRefs, wikiClient);
      markVisited(result, visited);
    }
    return result;
  };

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const prefix = `[${i + 1}/${total}]`;
    const existing = state.pages[child.nodeToken];
    visited?.add(child.nodeToken);

    if (!existing) {
      // ── New node: full copy ─────────────────────────────────────
      console.log(`${prefix} NEW: "${child.title}"`);
      const result = await runAsNew(child, prefix);
      results.push(result);
      sleep(500);
      onProgress?.();
      continue;
    }

    // ── Heal check: target deleted out-of-band ──────────────────
    // If we pre-walked the target tree and the tracked target node isn't
    // there, re-create in place regardless of source state. This covers
    // the "source unchanged but target deleted" case that the MOD-branch
    // heal (below) can't reach.
    if (presentTargets && !presentTargets.has(existing.targetNodeToken)) {
      console.log(`${prefix} HEAL: target deleted — re-creating "${child.title}"…`);
      delete state.pages[child.nodeToken];
      const healResult = await runAsNew(child, prefix);
      results.push(healResult);
      sleep(500);
      onProgress?.();
      continue;
    }

    // Propagate title rename regardless of content outcome. update_title
    // only applies to docx/doc/shortcut — non-docx nodes silently skip.
    if (child.title !== existing.title && (child.objType === "docx" || child.objType === "doc")) {
      if (wikiClient.updateNodeTitle(targetNode.spaceId, existing.targetNodeToken, child.title)) {
        console.log(`${prefix} RENAME: "${existing.title}" → "${child.title}"`);
        existing.title = child.title;
      } else {
        console.error(`${prefix} WARNING: title update failed for "${child.title}"`);
      }
    }

    // A prior run left images unuploaded for this page; force a re-copy
    // even if source metadata/content hasn't changed.
    const forceRetry = (existing.failedImages?.length ?? 0) > 0;

    // ── Existing node: check for changes ──────────────────────────
    if (!forceRetry && child.objEditTime !== "" && child.objEditTime === existing.objEditTime) {
      // Timestamp unchanged — skip
      if (opts.verbose) console.log(`${prefix} SKIP: "${child.title}" (unchanged)`);
      // Populate nodeMap/objMap so fixupReferences can rewrite links pointing here
      if (refs) {
        refs.nodeMap.set(child.nodeToken, existing.targetNodeToken);
        refs.objMap.set(child.objToken, existing.targetObjToken);
      }
      results.push({
        sourceToken: child.nodeToken, targetToken: existing.targetNodeToken,
        title: child.title, strategy: "unchanged", ok: true, children: [],
      });

      // Still recurse into children if it has any
      if (child.hasChild) {
        const childResults = await syncChildrenIncremental(
          wikiClient, child, existing, state, opts, refs, onProgress, visited, presentTargets,
        );
        results[results.length - 1].children = childResults;
      }
      continue;
    }

    // Timestamp changed (or forced retry) — check content hash
    if (child.objType === "docx") {
      const sourceBlocks = cli.getBlocks(child.objToken);
      const hash = computeContentHash(sourceBlocks);

      if (!forceRetry && hash === existing.contentHash) {
        // Content identical (metadata-only change)
        if (opts.verbose) console.log(`${prefix} SKIP: "${child.title}" (metadata-only change)`);
        existing.objEditTime = child.objEditTime;
        existing.lastSynced = new Date().toISOString();
        if (refs) {
          refs.nodeMap.set(child.nodeToken, existing.targetNodeToken);
          refs.objMap.set(child.objToken, existing.targetObjToken);
        }
        results.push({
          sourceToken: child.nodeToken, targetToken: existing.targetNodeToken,
          title: child.title, strategy: "unchanged", ok: true, children: [],
        });
      } else {
        // Heal: target may have been deleted out-of-band. Probe before
        // writing; if gone, drop state and re-create in place. Double-probe
        // with a short delay to avoid false positives on transient API
        // errors — getNode returns null on any error, not just 404.
        if (targetIsReallyGone(wikiClient, existing.targetNodeToken)) {
          console.log(`${prefix} HEAL: target deleted — re-creating "${child.title}"…`);
          delete state.pages[child.nodeToken];
          const healResult = await runAsNew(child, prefix);
          results.push(healResult);
          sleep(500);
          onProgress?.();
          continue;
        }

        // Content changed (or forced retry) — clear and re-copy
        const label = forceRetry && hash === existing.contentHash ? "RETRY" : "MOD";
        console.log(`${prefix} ${label}: "${child.title}" — updating…`);
        clearDocContent(cli, existing.targetObjToken);

        const imageCache = await prefetchImages(sourceBlocks, child.nodeToken, {
          verbose: opts.verbose, browserState: opts.browserState,
        });
        const headingNumbers = opts.headingNumbers
          ? computeHeadingNumbers(sourceBlocks)
          : undefined;

        const copyResult = copyDocBlocks(
          cli, sourceBlocks, existing.targetObjToken, imageCache,
          { verbose: opts.verbose, headingNumbers },
        );
        console.log(`${prefix}   ${copyResult.created} blocks created`);
        if (copyResult.failedImages.length > 0) {
          console.error(`${prefix}   WARNING: ${copyResult.failedImages.length} image(s) failed`);
          for (const f of copyResult.failedImages) {
            console.error(`${prefix}     - ${f.sourceToken.slice(0, 12)}…: ${f.reason}`);
          }
        }

        try {
          cleanupEmptyTails(cli, existing.targetObjToken, sourceBlocks);
        } catch { /* ignore */ }

        // Update refs for link fixup
        if (refs) {
          refs.nodeMap.set(child.nodeToken, existing.targetNodeToken);
          refs.objMap.set(child.objToken, existing.targetObjToken);
          refs.docMap.set(existing.targetNodeToken, existing.targetObjToken);
        }

        existing.objEditTime = child.objEditTime;
        existing.contentHash = hash;
        existing.lastSynced = new Date().toISOString();
        if (copyResult.failedImages.length > 0) {
          existing.failedImages = copyResult.failedImages.map(f => f.sourceToken);
        } else {
          delete existing.failedImages;
        }

        results.push({
          sourceToken: child.nodeToken, targetToken: existing.targetNodeToken,
          title: child.title, strategy: "updated", ok: true,
          failedImages: copyResult.failedImages.length > 0 ? copyResult.failedImages : undefined,
          children: [],
        });
      }
    } else {
      // Non-docx: can't diff, treat as unchanged
      if (opts.verbose) console.log(`${prefix} SKIP: "${child.title}" (non-docx, can't diff)`);
      if (refs) {
        refs.nodeMap.set(child.nodeToken, existing.targetNodeToken);
        refs.objMap.set(child.objToken, existing.targetObjToken);
      }
      results.push({
        sourceToken: child.nodeToken, targetToken: existing.targetNodeToken,
        title: child.title, strategy: "unchanged", ok: true, children: [],
      });
    }

    // Recurse into children
    if (child.hasChild) {
      const childResults = await syncChildrenIncremental(
        wikiClient, child, existing, state, opts, refs, onProgress, visited, presentTargets,
      );
      results[results.length - 1].children = childResults;
    }

    sleep(500);
    onProgress?.();
  }

  state.lastSyncTime = new Date().toISOString();
  return results;
}

/**
 * Recurse into children of an existing (already-mapped) node during incremental sync.
 */
async function syncChildrenIncremental(
  wikiClient: WikiClient,
  sourceChild: WikiNode,
  existing: PageState,
  state: SyncState,
  opts: SyncOptions,
  refs?: RefMaps,
  onProgress?: () => void,
  visited?: Set<string>,
  presentTargets?: Set<string>,
): Promise<SyncNodeResult[]> {
  // Build a temporary "target node" reference for recursion
  const targetNode: WikiNode = {
    nodeToken: existing.targetNodeToken,
    objToken: existing.targetObjToken,
    objType: sourceChild.objType,
    title: sourceChild.title,
    hasChild: true,
    spaceId: "", // filled from target context
    parentNodeToken: "",
    nodeType: "origin",
    objEditTime: "",
  };
  // Resolve actual target node to get spaceId
  const resolved = wikiClient.getNode(existing.targetNodeToken);
  if (!resolved) {
    console.error(`  WARNING: target node ${existing.targetNodeToken} no longer exists — skipping children of "${sourceChild.title}"`);
    return [];
  }
  targetNode.spaceId = resolved.spaceId;

  return syncTreeIncremental(
    wikiClient, sourceChild, targetNode, state, opts, refs, onProgress, visited,
    undefined, presentTargets,
  );
}

/** Walk a SyncNodeResult tree and mark every source token as visited. */
function markVisited(result: SyncNodeResult, visited?: Set<string>): void {
  if (!visited) return;
  visited.add(result.sourceToken);
  for (const c of result.children) markVisited(c, visited);
}

// ─── Internal ───────────────────────────────────────────────────────────

/**
 * After a server-copy, recursively match source children to target children
 * by position (server-copy preserves tree structure and order), populating
 * refs and returning synthetic SyncNodeResult[] for state recording.
 */
function buildServerCopyResults(
  wikiClient: WikiClient,
  sourceNodeToken: string,
  sourceSpaceId: string,
  targetNodeToken: string,
  targetSpaceId: string,
  refs?: RefMaps,
): SyncNodeResult[] {
  const srcChildren = wikiClient.listChildren(sourceSpaceId, sourceNodeToken);
  if (srcChildren.length === 0) return [];

  const tgtChildren = wikiClient.listChildren(targetSpaceId, targetNodeToken);
  const results: SyncNodeResult[] = [];

  for (let i = 0; i < srcChildren.length && i < tgtChildren.length; i++) {
    const src = srcChildren[i];
    const tgt = tgtChildren[i];

    if (refs) {
      refs.nodeMap.set(src.nodeToken, tgt.nodeToken);
      refs.objMap.set(src.objToken, tgt.objToken);
      refs.docMap.set(tgt.nodeToken, tgt.objToken);
    }

    const childResults = src.hasChild
      ? buildServerCopyResults(wikiClient, src.nodeToken, src.spaceId, tgt.nodeToken, tgt.spaceId, refs)
      : [];

    results.push({
      sourceToken: src.nodeToken,
      targetToken: tgt.nodeToken,
      title: src.title,
      strategy: "server-copy",
      ok: true,
      sourceObjToken: src.objToken,
      targetObjToken: tgt.objToken,
      children: childResults,
    });
  }
  return results;
}

export interface TargetCreatedInfo {
  sourceToken: string;
  targetNodeToken: string;
  targetObjToken: string;
  sourceObjToken: string;
  title: string;
  objType: string;
  objEditTime: string;
}

async function syncNode(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  targetParentToken: string,
  targetSpaceId: string,
  opts: SyncOptions,
  prefix: string,
  refs?: RefMaps,
  onTargetCreated?: (info: TargetCreatedInfo) => void,
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

    // Populate refs for the copied root node
    if (refs) {
      refs.nodeMap.set(sourceNode.nodeToken, copied.nodeToken);
      refs.objMap.set(sourceNode.objToken, copied.objToken);
      refs.docMap.set(copied.nodeToken, copied.objToken);
    }

    onTargetCreated?.({
      sourceToken: sourceNode.nodeToken,
      targetNodeToken: copied.nodeToken,
      targetObjToken: copied.objToken,
      sourceObjToken: sourceNode.objToken,
      title: sourceNode.title,
      objType: sourceNode.objType,
      objEditTime: sourceNode.objEditTime,
    });

    // Recursively match children for state tracking and ref fixup
    const childResults = sourceNode.hasChild
      ? buildServerCopyResults(
          wikiClient, sourceNode.nodeToken, sourceNode.spaceId,
          copied.nodeToken, copied.spaceId || targetSpaceId, refs,
        )
      : [];

    return {
      sourceToken: sourceNode.nodeToken, targetToken: copied.nodeToken,
      title: sourceNode.title, strategy: "server-copy", ok: true,
      sourceObjToken: sourceNode.objToken,
      targetObjToken: copied.objToken,
      children: childResults,
    };
  }

  // ── Strategy 2: block-level copy (preserves all styles) ───────────
  if (sourceNode.objType !== "docx") {
    const placeholder = wikiClient.createNode(
      targetSpaceId, targetParentToken, sourceNode.title, "docx",
    );
    const pToken = placeholder?.nodeToken ?? null;
    if (pToken && placeholder) {
      console.log(`${prefix}   Created placeholder → ${pToken}`);
      onTargetCreated?.({
        sourceToken: sourceNode.nodeToken,
        targetNodeToken: pToken,
        targetObjToken: placeholder.objToken,
        sourceObjToken: sourceNode.objToken,
        title: sourceNode.title,
        objType: sourceNode.objType,
        objEditTime: sourceNode.objEditTime,
      });
    } else {
      console.error(`${prefix}   FAIL: could not create placeholder`);
    }
    const childResults = sourceNode.hasChild && pToken
      ? await syncTree(wikiClient, sourceNode, pToken, targetSpaceId, opts, refs, onTargetCreated)
      : [];
    return {
      sourceToken: sourceNode.nodeToken, targetToken: pToken,
      title: sourceNode.title, strategy: "block-copy",
      ok: pToken !== null, error: pToken ? undefined : "Failed to create placeholder",
      sourceObjToken: sourceNode.objToken,
      targetObjToken: placeholder?.objToken,
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

  // Pre-register in state BEFORE block copy so a mid-copy kill is resumable
  // as a MOD into the same target node (no duplicate).
  onTargetCreated?.({
    sourceToken: sourceNode.nodeToken,
    targetNodeToken: newNode.nodeToken,
    targetObjToken,
    sourceObjToken: sourceNode.objToken,
    title: sourceNode.title,
    objType: sourceNode.objType,
    objEditTime: sourceNode.objEditTime,
  });

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
  if (result.failedImages.length > 0) {
    console.error(`${prefix}   WARNING: ${result.failedImages.length} image(s) failed`);
    for (const f of result.failedImages) {
      console.error(`${prefix}     - ${f.sourceToken.slice(0, 12)}…: ${f.reason}`);
    }
  }
  if (result.unsupportedTypes.size > 0) {
    const parts: string[] = [];
    for (const [bt, count] of result.unsupportedTypes) {
      const name = BLOCK_TYPE_NAME[bt] ?? `unknown`;
      parts.push(`${name}(${bt})×${count}`);
    }
    console.log(`${prefix}   ⚠ Unsupported block types: ${parts.join(", ")}`);
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
    ? await syncTree(wikiClient, sourceNode, newNode.nodeToken, targetSpaceId, opts, refs, onTargetCreated)
    : [];

  console.log(`${prefix}   OK (block-copy)`);
  return {
    sourceToken: sourceNode.nodeToken, targetToken: newNode.nodeToken,
    title: sourceNode.title, strategy: "block-copy", ok: true,
    unsupportedTypes: result.unsupportedTypes.size > 0 ? result.unsupportedTypes : undefined,
    failedImages: result.failedImages.length > 0 ? result.failedImages : undefined,
    contentHash: computeContentHash(sourceBlocks),
    sourceObjToken: sourceNode.objToken,
    targetObjToken,
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

/**
 * Returns true only if two probes a second apart both report the node missing.
 * Guards the heal path against transient API errors — `wikiClient.getNode`
 * returns null on any failure, not just 404, so a single null is ambiguous.
 */
function targetIsReallyGone(wikiClient: WikiClient, nodeToken: string): boolean {
  if (wikiClient.getNode(nodeToken) !== null) return false;
  sleep(1000);
  return wikiClient.getNode(nodeToken) === null;
}

// ─── Orphan Detection ───────────────────────────────────────────────────

export interface Orphan {
  sourceToken: string;
  targetNodeToken: string;
  title: string;
}

/**
 * Find pages in state.pages whose source nodeToken was NOT visited this run.
 * These represent source pages that have been deleted or moved out of the
 * subtree. The caller decides whether to report or prune.
 */
export function findOrphans(state: SyncState, visited: Set<string>): Orphan[] {
  const orphans: Orphan[] = [];
  for (const [srcToken, page] of Object.entries(state.pages)) {
    if (!visited.has(srcToken)) {
      orphans.push({
        sourceToken: srcToken,
        targetNodeToken: page.targetNodeToken,
        title: page.title,
      });
    }
  }
  return orphans;
}

/** Remove orphaned entries from state.pages (state-only, does not touch target). */
export function pruneOrphansFromState(state: SyncState, orphans: Orphan[]): void {
  for (const o of orphans) delete state.pages[o.sourceToken];
}

// ─── State Recording ───────────────────────────────────────────────────

/** Walk sync results recursively and populate state.pages with the mapping. */
export function recordResultsInState(
  state: SyncState,
  results: SyncNodeResult[],
  refs: RefMaps,
  wikiClient: WikiClient,
): void {
  for (const r of results) {
    if (r.ok && r.targetToken && r.strategy !== "skipped") {
      // Use pre-computed values from SyncNodeResult when available;
      // fall back to API lookup
      const targetObjToken = r.targetObjToken
        ?? refs.docMap.get(r.targetToken)
        ?? wikiClient.getNode(r.targetToken)?.objToken
        ?? "";
      const sourceObjToken = r.sourceObjToken
        ?? wikiClient.getNode(r.sourceToken)?.objToken
        ?? "";

      let contentHash = r.contentHash ?? "";
      if (!contentHash && sourceObjToken) {
        try {
          const blocks = wikiClient.cli.getBlocks(sourceObjToken);
          contentHash = computeContentHash(blocks);
        } catch { /* leave empty */ }
      }

      const srcNode = wikiClient.getNode(r.sourceToken);
      const pageState: PageState = {
        targetNodeToken: r.targetToken,
        targetObjToken,
        sourceObjToken,
        title: r.title,
        objEditTime: srcNode?.objEditTime ?? "",
        contentHash,
        lastSynced: new Date().toISOString(),
      };
      if (r.failedImages && r.failedImages.length > 0) {
        pageState.failedImages = r.failedImages.map(f => f.sourceToken);
      }
      state.pages[r.sourceToken] = pageState;
    }
    if (r.children.length > 0) {
      recordResultsInState(state, r.children, refs, wikiClient);
    }
  }
}

// ─── Summary ────────────────────────────────────────────────────────────

export function printSummary(results: SyncNodeResult[], rootFailedImages?: FailedImage[]): void {
  let copied = 0;
  let blockCopy = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  let imagesFailed = rootFailedImages?.length ?? 0;
  const allUnsupported = new Map<number, number>();

  function count(list: SyncNodeResult[]): void {
    for (const r of list) {
      if (!r.ok) failed++;
      else if (r.strategy === "server-copy") copied++;
      else if (r.strategy === "block-copy") blockCopy++;
      else if (r.strategy === "updated") updated++;
      else if (r.strategy === "unchanged") unchanged++;
      else skipped++;
      if (r.unsupportedTypes) {
        for (const [bt, n] of r.unsupportedTypes) {
          allUnsupported.set(bt, (allUnsupported.get(bt) ?? 0) + n);
        }
      }
      if (r.failedImages) imagesFailed += r.failedImages.length;
      count(r.children);
    }
  }
  count(results);

  console.log("\n── Sync Summary ──");
  if (copied > 0) console.log(`  Server-copied: ${copied}`);
  if (blockCopy > 0) console.log(`  Block-copied:  ${blockCopy}`);
  if (updated > 0) console.log(`  Updated:       ${updated}`);
  if (unchanged > 0) console.log(`  Unchanged:     ${unchanged}`);
  if (skipped > 0) console.log(`  Skipped:       ${skipped}`);
  if (failed > 0) console.log(`  Failed:        ${failed}`);
  console.log(`  Total:         ${copied + blockCopy + updated + unchanged + skipped + failed}`);

  if (allUnsupported.size > 0) {
    console.log("\n  ⚠ Unsupported block types (content may be lost):");
    for (const [bt, n] of [...allUnsupported.entries()].sort((a, b) => a[0] - b[0])) {
      const name = BLOCK_TYPE_NAME[bt] ?? "unknown";
      console.log(`    - ${name} (type ${bt}): ${n} block(s)`);
    }
  }

  if (imagesFailed > 0) {
    console.log(`\n  ⚠ ${imagesFailed} image(s) failed to sync`);
  }
}

// ─── Check Mode (read-only drift detection) ─────────────────────────────

export type CheckKind = "new" | "modified" | "retry" | "rename" | "orphan" | "missing";

export interface CheckChange {
  kind: CheckKind;
  title: string;
  sourceToken?: string;
  targetToken?: string;
  reason?: string;
}

export interface CheckReport {
  rootChanged: boolean;
  changes: CheckChange[];
  unchangedCount: number;
  totalSourcePages: number;
}

/**
 * Walk source tree and compare against saved state without writing anything.
 * Mirrors the classification logic of syncTreeIncremental so the report
 * matches what a real sync would do.
 *
 * Also walks the target tree to detect pages that were deleted out-of-band
 * (e.g., user removed them in the Feishu UI). These are reported as
 * "missing" and will be auto-healed by the next `sync` that touches them.
 */
export function checkSync(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  targetNode: WikiNode,
  state: SyncState,
): CheckReport {
  const cli = wikiClient.cli;
  const report: CheckReport = {
    rootChanged: false,
    changes: [],
    unchangedCount: 0,
    totalSourcePages: 0,
  };

  if (sourceNode.objType === "docx") {
    const editDiffers = sourceNode.objEditTime !== "" &&
      sourceNode.objEditTime !== (state.rootObjEditTime ?? "");
    if (editDiffers || state.rootContentHash === "") {
      const blocks = cli.getBlocks(sourceNode.objToken);
      const hash = computeContentHash(blocks);
      if (hash !== state.rootContentHash) report.rootChanged = true;
    }
  }

  const visited = new Set<string>();
  checkTreeRecursive(wikiClient, sourceNode, state, visited, report);

  // Walk the target tree and collect every existing target node token.
  // O(targetParents) API calls — same cost profile as the source walk.
  const presentTargets = new Set<string>();
  collectTargetTokens(wikiClient, targetNode, presentTargets);

  // Any state entry whose source was visited this run but whose target
  // is no longer under the target subtree is "missing" — target was
  // deleted or moved out of scope. (Non-visited entries are already
  // classified as "orphan" below.)
  for (const [srcToken, page] of Object.entries(state.pages)) {
    if (visited.has(srcToken) && !presentTargets.has(page.targetNodeToken)) {
      report.changes.push({
        kind: "missing",
        title: page.title,
        sourceToken: srcToken,
        targetToken: page.targetNodeToken,
        reason: "target deleted",
      });
    }
  }

  for (const [srcToken, page] of Object.entries(state.pages)) {
    if (!visited.has(srcToken)) {
      report.changes.push({
        kind: "orphan",
        title: page.title,
        sourceToken: srcToken,
        targetToken: page.targetNodeToken,
      });
    }
  }

  return report;
}

/** Recursively collect every nodeToken present under `root` in the target space. */
function collectTargetTokens(
  wikiClient: WikiClient,
  root: WikiNode,
  out: Set<string>,
): void {
  const children = wikiClient.listChildren(root.spaceId, root.nodeToken);
  for (const c of children) {
    out.add(c.nodeToken);
    if (c.hasChild) collectTargetTokens(wikiClient, c, out);
  }
}

/**
 * Public wrapper: walk the target subtree once and return every present
 * nodeToken. Used by the sync command to pre-detect MISSING pages so the
 * incremental loop can heal them even when the source is unchanged.
 */
export function buildPresentTargets(
  wikiClient: WikiClient,
  targetRoot: WikiNode,
): Set<string> {
  const out = new Set<string>();
  collectTargetTokens(wikiClient, targetRoot, out);
  return out;
}

function checkTreeRecursive(
  wikiClient: WikiClient,
  sourceNode: WikiNode,
  state: SyncState,
  visited: Set<string>,
  report: CheckReport,
): void {
  const children = wikiClient.listChildren(sourceNode.spaceId, sourceNode.nodeToken);
  for (const child of children) {
    report.totalSourcePages++;
    visited.add(child.nodeToken);
    const existing = state.pages[child.nodeToken];

    if (!existing) {
      report.changes.push({
        kind: "new",
        title: child.title,
        sourceToken: child.nodeToken,
      });
      if (child.hasChild) {
        checkTreeRecursive(wikiClient, child, state, visited, report);
      }
      continue;
    }

    if (child.title !== existing.title) {
      report.changes.push({
        kind: "rename",
        title: child.title,
        sourceToken: child.nodeToken,
        targetToken: existing.targetNodeToken,
        reason: `was "${existing.title}"`,
      });
    }

    const failedCount = existing.failedImages?.length ?? 0;
    if (failedCount > 0) {
      report.changes.push({
        kind: "retry",
        title: child.title,
        sourceToken: child.nodeToken,
        targetToken: existing.targetNodeToken,
        reason: `${failedCount} image(s) pending retry`,
      });
    } else if (child.objEditTime !== "" && child.objEditTime === existing.objEditTime) {
      report.unchangedCount++;
    } else if (child.objType === "docx") {
      const blocks = wikiClient.cli.getBlocks(child.objToken);
      const hash = computeContentHash(blocks);
      if (hash === existing.contentHash) {
        report.unchangedCount++;
      } else {
        report.changes.push({
          kind: "modified",
          title: child.title,
          sourceToken: child.nodeToken,
          targetToken: existing.targetNodeToken,
        });
      }
    } else {
      report.unchangedCount++;
    }

    if (child.hasChild) {
      checkTreeRecursive(wikiClient, child, state, visited, report);
    }
  }
}

/**
 * Print the check report. Returns true if the target is in sync with source.
 */
export function printCheckReport(
  report: CheckReport,
  sourceTitle: string,
  targetTitle: string,
  state: SyncState,
): boolean {
  const byKind: Record<CheckKind, CheckChange[]> = {
    new: [], modified: [], retry: [], rename: [], orphan: [], missing: [],
  };
  for (const c of report.changes) byKind[c.kind].push(c);

  console.log(`\n── Sync Check: "${sourceTitle}" → "${targetTitle}" ──`);
  console.log(`  Last synced:   ${state.lastSyncTime}`);
  console.log(`  Tracked pages: ${Object.keys(state.pages).length}`);
  console.log(`  Source pages:  ${report.totalSourcePages}`);

  const totalChanges =
    report.changes.length + (report.rootChanged ? 1 : 0);

  if (totalChanges === 0) {
    console.log("\n✓ In sync — target matches source.");
    return true;
  }

  console.log("\nPending changes:");
  if (report.rootChanged) console.log('  ~ MOD    root page');

  const SYM: Record<CheckKind, string> = {
    new: "+", modified: "~", retry: "⟲", rename: "→", orphan: "-", missing: "✗",
  };
  const LABEL: Record<CheckKind, string> = {
    new: "NEW    ", modified: "MOD    ", retry: "RETRY  ",
    rename: "RENAME ", orphan: "ORPHAN ", missing: "MISSING",
  };
  const ORDER: CheckKind[] = ["new", "modified", "missing", "retry", "rename", "orphan"];
  for (const kind of ORDER) {
    for (const c of byKind[kind]) {
      const reason = c.reason ? ` — ${c.reason}` : "";
      console.log(`  ${SYM[kind]} ${LABEL[kind]} "${c.title}"${reason}`);
    }
  }

  console.log("\nSummary:");
  if (byKind.new.length)      console.log(`  New:       ${byKind.new.length}`);
  if (byKind.modified.length) console.log(`  Modified:  ${byKind.modified.length}`);
  if (byKind.missing.length)  console.log(`  Missing:   ${byKind.missing.length} (target deleted, will re-create on next sync)`);
  if (byKind.retry.length)    console.log(`  Retry:     ${byKind.retry.length}`);
  if (byKind.rename.length)   console.log(`  Renamed:   ${byKind.rename.length}`);
  if (byKind.orphan.length)   console.log(`  Orphans:   ${byKind.orphan.length}`);
  if (report.rootChanged)     console.log(`  Root page: changed`);
  console.log(`  Unchanged: ${report.unchangedCount}`);

  console.log(`\n✗ Out of sync — ${totalChanges} change(s) pending.`);
  return false;
}
