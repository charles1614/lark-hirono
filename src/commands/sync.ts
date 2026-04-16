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
import { syncTree, syncRootContent, syncTreeIncremental, printTree, printSummary } from "../wiki/sync.js";
import { fixupReferences, type RefMaps } from "../wiki/fix-refs.js";
import { loadState, saveState, buildInitialState, computeContentHash } from "../wiki/sync-state.js";
import type { FailedImage } from "../wiki/block-copy.js";
import type { SyncOptions, SyncNodeResult } from "../wiki/wiki-types.js";
import type { SyncState } from "../wiki/sync-state.js";

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
      if (["dry-run", "verbose", "numbers", "no-numbers", "force", "status"].includes(key)) {
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

  const refs: RefMaps = {
    nodeMap: new Map(),
    objMap: new Map(),
    docMap: new Map(),
  };

  let results: SyncNodeResult[];
  let rootFailedImages: FailedImage[] = [];

  if (existingState) {
    // ── Incremental sync ───────────────────────────────────────────
    console.log(`\nIncremental sync "${sourceNode.title}" → "${targetNode.title}"…`);
    console.log(`  (last synced: ${existingState.lastSyncTime})\n`);

    results = await syncTreeIncremental(
      wikiClient, sourceNode, targetNode, existingState, opts, refs,
    );

    // Fix internal document references
    if (refs.docMap.size > 0) {
      fixupReferences(cli, refs, { verbose });
    }

    // Save updated state
    saveState(existingState);
  } else {
    // ── First-run: full copy ───────────────────────────────────────
    console.log(`\nSyncing "${sourceNode.title}" → "${targetNode.title}"…\n`);

    // Mirror root page content (source → target)
    const rootResult = await syncRootContent(wikiClient, sourceNode, targetNode, opts, refs);
    rootFailedImages = rootResult.failedImages;

    results = await syncTree(
      wikiClient, sourceNode, targetNode.nodeToken, targetNode.spaceId, opts, refs,
    );

    // Fix internal document references
    if (refs.docMap.size > 0) {
      fixupReferences(cli, refs, { verbose });
    }

    // Build and save initial state
    const rootBlocks = sourceNode.objType === "docx"
      ? cli.getBlocks(sourceNode.objToken) : [];
    const state = buildInitialState(
      sourceNode.nodeToken,
      targetNode.nodeToken,
      computeContentHash(rootBlocks),
    );
    // Record all successfully synced pages
    recordResultsInState(state, results, refs, wikiClient);
    saveState(state);
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

/** Walk sync results and populate state.pages with the mapping. */
function recordResultsInState(
  state: SyncState,
  results: SyncNodeResult[],
  refs: RefMaps,
  wikiClient: WikiClient,
): void {
  for (const r of results) {
    if (r.ok && r.targetToken && r.strategy !== "skipped") {
      // Resolve obj tokens from refs or by fetching the node
      const targetObjToken = refs.docMap.get(r.targetToken) ?? "";
      const sourceObjToken = refs.objMap.has(r.sourceToken)
        ? r.sourceToken  // sourceToken is a node token, need to find obj token
        : "";

      // Look up actual obj tokens from the wiki client
      const srcNode = wikiClient.getNode(r.sourceToken);
      const tgtNode = wikiClient.getNode(r.targetToken);

      const pageState: typeof state.pages[string] = {
        targetNodeToken: r.targetToken,
        targetObjToken: tgtNode?.objToken ?? targetObjToken,
        sourceObjToken: srcNode?.objToken ?? sourceObjToken,
        title: r.title,
        objEditTime: srcNode?.objEditTime ?? "",
        contentHash: "", // computed on next incremental run
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
  --force                   Ignore saved state, force full re-sync
  --status                  Show sync status without syncing
  -v, --verbose             Verbose logging

Mirror Semantics:
  The target node mirrors the source: both root page content and child
  nodes are synced. On first run, a full copy is performed. On subsequent
  runs, only new and modified pages are synced (incremental).

  Sync state is saved to ~/.config/lark-hirono/sync-state/ and used to
  detect changes on the next run.

Image Transfer:
  Images are downloaded via Playwright browser session (bypasses API 403).
  On first run, a browser window opens for Feishu login. The session is
  cached for subsequent headless runs.

Examples:
  lark-hirono sync \\
    --from https://my.feishu.cn/wiki/SRC_TOKEN \\
    --to https://my.feishu.cn/wiki/DST_TOKEN

  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --dry-run
  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --force
  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --status
`);
}
