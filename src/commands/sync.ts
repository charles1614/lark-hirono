/**
 * sync command — recursively copy a wiki subtree to a target location.
 *
 * Uses block-level copy to preserve ALL document styles and images.
 *
 * Usage:
 *   lark-hirono sync --from <url> --to <url> [--dry-run] [-v]
 */

import { LarkCli } from "../cli.js";
import { WikiClient } from "../wiki/wiki-client.js";
import { parseWikiUrl } from "../wiki/wiki-url.js";
import { syncTreeIncremental, printTree, printSummary, findOrphans, pruneOrphansFromState, checkSync, printCheckReport } from "../wiki/sync.js";
import { closeBrowser } from "../browser/image-transfer.js";
import { fixupReferences, type RefMaps } from "../wiki/fix-refs.js";
import { loadState, saveState, buildInitialState } from "../wiki/sync-state.js";
import type { FailedImage } from "../wiki/block-copy.js";
import type { SyncOptions, SyncNodeResult } from "../wiki/wiki-types.js";

export async function run(args: string[]): Promise<number> {
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      showHelp();
      return 0;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (["dry-run", "verbose", "numbers", "no-numbers", "force", "status", "check"].includes(key)) {
        flags[key] = true;
      } else {
        flags[key] = args[++i] ?? "";
      }
    } else if (a === "-v") {
      flags.verbose = true;
    } else if (a === "-n") {
      flags.numbers = true;
    }
  }

  const fromUrl = flags.from as string | undefined;
  const toUrl = flags.to as string | undefined;

  if (!fromUrl || !toUrl) {
    console.error("Error: --from and --to are required");
    console.error("Usage: lark-hirono sync --from <url> --to <url> [--dry-run]");
    return 1;
  }

  const dryRun = Boolean(flags["dry-run"]);
  const verbose = Boolean(flags.verbose);
  const headingNumbers = !flags["no-numbers"];
  const force = Boolean(flags.force);
  const status = Boolean(flags.status);
  const check = Boolean(flags.check);
  const browserState = flags["browser-state"] as string | undefined;

  let source, target;
  try {
    source = parseWikiUrl(fromUrl);
    target = parseWikiUrl(toUrl);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return 1;
  }

  const cli = new LarkCli({ retries: 3 });
  const wikiClient = new WikiClient(cli);

  if (verbose) console.log(`Resolving source: ${source.nodeToken}…`);
  const sourceNode = wikiClient.getNode(source.nodeToken);
  if (!sourceNode) {
    console.error(`Error: could not resolve source node: ${source.nodeToken}`);
    return 1;
  }
  if (verbose) {
    console.log(`  Source: "${sourceNode.title}" (${sourceNode.objType}) in space ${sourceNode.spaceId}`);
  }

  if (verbose) console.log(`Resolving target: ${target.nodeToken}…`);
  const targetNode = wikiClient.getNode(target.nodeToken);
  if (!targetNode) {
    console.error(`Error: could not resolve target node: ${target.nodeToken}`);
    return 1;
  }
  if (verbose) {
    console.log(`  Target: "${targetNode.title}" (${targetNode.objType}) in space ${targetNode.spaceId}`);
  }

  const opts: SyncOptions = {
    dryRun,
    verbose,
    headingNumbers,
    browserState,
  };

  if (dryRun) {
    console.log("\n── Source Tree ──");
    printTree(wikiClient, sourceNode);
    console.log(`\n→ Would sync to: "${targetNode.title}" (${targetNode.nodeToken})`);
    return 0;
  }

  // ── Check for existing sync state ──────────────────────────────────
  const existingState = force ? null : loadState(sourceNode.nodeToken, targetNode.nodeToken);

  if (status) {
    if (!existingState) {
      console.log("No previous sync state found — first run will do a full copy.");
    } else {
      console.log(`Last synced: ${existingState.lastSyncTime}`);
      console.log(`Tracked pages: ${Object.keys(existingState.pages).length}`);
    }
    return 0;
  }

  if (check) {
    if (!existingState) {
      console.log(`\n── Sync Check: "${sourceNode.title}" → "${targetNode.title}" ──`);
      console.log("No previous sync state — a full copy would be performed.");
      console.log("\n✗ Out of sync — run without --check to perform initial sync.");
      return 1;
    }
    const report = checkSync(wikiClient, sourceNode, targetNode, existingState);
    const inSync = printCheckReport(report, sourceNode.title, targetNode.title, existingState);
    return inSync ? 0 : 1;
  }

  const refs: RefMaps = {
    nodeMap: new Map(),
    objMap: new Map(),
    docMap: new Map(),
  };

  let results: SyncNodeResult[];
  const rootFailedImages: FailedImage[] = [];

  // Unify first-run and incremental: build an empty state up front if none
  // exists, persist it immediately, then always go through the incremental
  // path. This gives us per-child persistence on first run — a kill after
  // any child completes is resumable with no duplicate target nodes.
  const isResume = existingState !== null;
  const state = existingState ?? buildInitialState(
    sourceNode.nodeToken,
    targetNode.nodeToken,
    "",
    "",
  );
  if (!isResume) {
    saveState(state);
  }

  try {
    if (isResume) {
      console.log(`\nIncremental sync "${sourceNode.title}" → "${targetNode.title}"…`);
      console.log(`  (last synced: ${state.lastSyncTime})\n`);
    } else {
      console.log(`\nSyncing "${sourceNode.title}" → "${targetNode.title}"…\n`);
    }

    const visited = new Set<string>();
    results = await syncTreeIncremental(
      wikiClient, sourceNode, targetNode, state, opts, refs,
      () => saveState(state),
      visited,
      rootFailedImages,
    );

    // Fix internal document references. On resume before firstRunComplete,
    // force a fixupReferences pass even when nothing changed this run —
    // the prior interrupted run may not have gotten there.
    const needFixup = refs.docMap.size > 0 || state.firstRunComplete !== true;
    if (needFixup) {
      if (targetNode.objToken) {
        refs.docMap.set(targetNode.nodeToken, targetNode.objToken);
      }
      for (const page of Object.values(state.pages)) {
        if (!refs.docMap.has(page.targetNodeToken) && page.targetObjToken) {
          refs.docMap.set(page.targetNodeToken, page.targetObjToken);
        }
      }
      if (refs.docMap.size > 0) {
        fixupReferences(cli, refs, { verbose });
      }
    }

    // Orphan detection is only meaningful once a full sync has landed.
    // Before firstRunComplete, "missing" source tokens may just be pages
    // a prior interrupted run never reached.
    if (state.firstRunComplete) {
      const orphans = findOrphans(state, visited);
      if (orphans.length > 0) {
        console.log(`\n  ⚠ ${orphans.length} orphan(s) detected (source deleted or moved out of subtree):`);
        for (const o of orphans) {
          console.log(`    - "${o.title}" (target ${o.targetNodeToken})`);
        }
        console.log(`  These target pages remain but are no longer tracked in state.`);
        console.log(`  Delete them manually in Feishu, then re-run with --force to rebuild state cleanly.`);
        pruneOrphansFromState(state, orphans);
      }
    }

    state.firstRunComplete = true;
    saveState(state);
  } finally {
    await closeBrowser();
  }

  printSummary(results, rootFailedImages);

  const anyFailed = results.some(function hasFail(r): boolean {
    return !r.ok || r.children.some(hasFail);
  });
  const anyImagesFailed = rootFailedImages.length > 0 || results.some(function hasImageFail(r): boolean {
    return (r.failedImages?.length ?? 0) > 0 || r.children.some(hasImageFail);
  });

  return anyFailed || anyImagesFailed ? 1 : 0;
}

function showHelp(): void {
  console.log(`
lark-hirono sync — Mirror wiki subtree with incremental sync

Usage:
  lark-hirono sync --from <url> --to <url> [options]

Arguments:
  --from <url>              Source wiki URL or node token
  --to <url>                Target wiki URL or node token (mirror target)

Options:
  --no-numbers              Skip auto-numbered headings (enabled by default)
  --browser-state <path>    Playwright browser state file
                            (default: ~/.config/lark-hirono/browser-state.json)
  --dry-run                 Print source tree without syncing
  --check                   Read-only diff of source and target vs saved
                            state. Reports new/modified/missing/retry/
                            rename/orphan pages. Exit 0 if in sync,
                            1 if drift or no state.
  --status                  Show saved-state metadata only (offline, no API)
  --force                   Ignore saved state, force full re-sync
  -v, --verbose             Verbose logging

Mirror Semantics:
  The target node mirrors the source: both root page content and child
  nodes are synced. On first run, a full copy is performed. On subsequent
  runs, only new and modified pages are synced (incremental).

  Sync state is saved to ~/.config/lark-hirono/sync-state/ and used to
  detect changes on the next run.

Auto-Heal:
  If a target page is deleted out-of-band (e.g., manually in Feishu),
  the next sync that re-writes it will auto-detect and re-create it in
  place. Run --check to surface deletions of pages whose source hasn't
  changed.

Image Transfer:
  Images are downloaded via Playwright browser session (bypasses API 403).
  On first run, a browser window opens for Feishu login. The session is
  cached for subsequent headless runs.

Examples:
  lark-hirono sync \\
    --from https://my.feishu.cn/wiki/SRC_TOKEN \\
    --to https://my.feishu.cn/wiki/DST_TOKEN

  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --dry-run
  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --check
  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --force
  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --status
`);
}
