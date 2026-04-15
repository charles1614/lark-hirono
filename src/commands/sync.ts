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
import { syncTree, printTree, printSummary } from "../wiki/sync.js";
import type { SyncOptions } from "../wiki/wiki-types.js";

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
      if (["dry-run", "verbose", "numbers", "no-numbers"].includes(key)) {
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

  console.log(`\nSyncing "${sourceNode.title}" → "${targetNode.title}"…\n`);
  const results = await syncTree(
    wikiClient, sourceNode, targetNode.nodeToken, targetNode.spaceId, opts,
  );

  printSummary(results);

  const anyFailed = results.some(function hasFail(r): boolean {
    return !r.ok || r.children.some(hasFail);
  });

  return anyFailed ? 1 : 0;
}

function showHelp(): void {
  console.log(`
lark-hirono sync — Recursively copy wiki subtree

Usage:
  lark-hirono sync --from <url> --to <url> [options]

Arguments:
  --from <url>              Source wiki URL or node token
  --to <url>                Target wiki URL or node token (children created under this)

Options:
  --no-numbers              Skip auto-numbered headings (enabled by default)
  --browser-state <path>    Playwright browser state file
                            (default: ~/.config/lark-hirono/browser-state.json)
  --dry-run                 Print source tree without syncing
  -v, --verbose             Verbose logging

Image Transfer:
  Images are downloaded via Playwright browser session (bypasses API 403).
  On first run, a browser window opens for Feishu login. The session is
  cached for subsequent headless runs.

Examples:
  lark-hirono sync \\
    --from https://my.feishu.cn/wiki/SRC_TOKEN \\
    --to https://my.feishu.cn/wiki/DST_TOKEN

  lark-hirono sync --from SRC_TOKEN --to DST_TOKEN --dry-run
`);
}
