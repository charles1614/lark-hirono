---
name: lark-hirono-sync
description: >-
  Recursively copy/sync a Feishu wiki subtree from one location to another,
  preserving all block-level styles (heading backgrounds, callouts, text colors,
  table formatting, images) via block-level copy. Also supports a read-only
  --check mode that diffs source vs target and reports pending changes.
  Triggers on: wiki sync, wiki copy, feishu sync, copy wiki tree, sync wiki
  pages, check wiki sync, verify wiki sync, wiki drift, is wiki up to date.
compatibility: Requires Node.js 20+, lark-cli >= 1.0.9. Playwright optional for image transfer.
---

# Lark Hirono Sync — Recursive Wiki Subtree Copy

Copy a Feishu wiki subtree from one location to another, preserving all content and block-level styles.

## Running the CLI

1. **Global install** — `lark-hirono sync [options]`
2. **Local dev repo** — `npx tsx bin/lark-hirono.ts sync [options]`

## First-Time Setup

Run these steps once before first use.

### 1. Install lark-hirono and authenticate

Follow the "First-Time Setup" steps in the main `lark-hirono` skill (install lark-hirono → install lark-cli → `lark-cli config init` → `lark-hirono auth login --domain docs`).

### 2. Install Playwright + Chromium (required for cross-space images)

Cross-space image downloads via the Feishu API return 403. The sync command uses Playwright with browser session cookies to download images through Feishu's internal CDN instead. Without Playwright, **sync still runs but all cross-space images are skipped** — the sync summary reports the count of failed images and exits with code 1.

Playwright is declared as an `optionalDependency` in package.json. If it wasn't installed automatically:

```bash
npm install playwright
npx playwright install chromium
```

### 3. Browser login for image transfer

On first sync with images, Playwright launches a **visible browser window** pointing to Feishu. Log in manually. After login, the session is saved to `~/.config/lark-hirono/browser-state.json` and reused headlessly for subsequent runs.

**Requirements:**
- A display environment (desktop or X11 forwarding) — the first run needs a visible browser. This will **not work over plain SSH or in CI** without a display.
- After the first login, subsequent runs are headless and work without a display.

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `playwright not installed` error mid-sync | Playwright not in node_modules | `npm install playwright && npx playwright install chromium` |
| `Cannot launch browser (need display)` | No display (SSH/CI) | Run the first sync from a desktop environment, or copy a valid `browser-state.json` from another machine |
| Sync summary shows failed images | Browser session expired or download 403 | Delete `~/.config/lark-hirono/browser-state.json` and re-run to trigger a fresh login |
| All images fail after the first failure in one run | Once Playwright fails once in a process, the sync disables it for the rest of that run to avoid hanging | Fix the root cause (login expired → delete `browser-state.json`; missing display → run from desktop), then re-run the sync command |
| Image upload failures in summary | Upload API failed or verification found empty token | Re-run sync normally (Rule 1 in the Recovery Playbook). Never `--force` |
| Sync was killed / timed out mid-run | Process interrupted | Re-run sync normally. State is persisted per-child — no duplicates, no lost progress |
| `--check` shows orphans | Source pages deleted or moved out of subtree | Ignore (informational) or delete the orphan target pages manually in Feishu |
| Exit code 1 but most of the tree synced | Any image or page failed | Re-run sync normally. Exit 1 is not a fatal signal |

### Prerequisites Summary

- Node.js 20+, `lark-cli` >= 1.0.9 (installed and authenticated)
- Playwright + Chromium (required for cross-space images; without it sync works but images are skipped)
- Display environment for first browser login (subsequent runs are headless)

## Usage

```bash
lark-hirono sync --from <source-url> --to <target-url> [options]
```

**Options:**
- `--from <url>` — Source wiki URL or bare node token (required)
- `--to <url>` — Target wiki node that will mirror the source (required). The target node's document receives the source root's block content; source children are created as children under the target node. Existing target content is cleared on first sync; existing target children outside the mirrored tree are left alone but flagged as ORPHAN
- `--no-numbers` — Skip auto-numbered headings (numbering enabled by default)
- `--browser-state <path>` — Path to Playwright browser state file (default: `~/.config/lark-hirono/browser-state.json`)
- `--dry-run` — Print source tree structure without copying
- `--check` — Read-only diff of source vs saved state; also walks the target tree to detect pages deleted out-of-band. Reports new/modified/missing/retry/rename/orphan pages. Exit `0` if fully in sync, `1` if drift detected (usable as a CI check). Pages flagged `missing` are auto-recreated by the next `sync` that touches them.
- `--status` — Print saved-state metadata only (last sync time, tracked page count); offline, no API calls
- `--force` — ⚠ **Rarely correct. See the Recovery Playbook below before using.** Discards saved state and recopies every page from scratch.
- `-v, --verbose` — Verbose logging

---

## Recovery Playbook — Read This Before Reacting to Any Failure

This section is the canonical answer to "the sync failed / `--check` reports drift / images didn't upload / the run was interrupted / exit code was 1 / something looks wrong." Apply these rules before suggesting anything to the user.

### Rule 1: The default recovery action is always a plain re-run

```bash
lark-hirono sync --from <SAME_SOURCE> --to <SAME_TARGET> -v
```

No `--force`. No other flags. The incremental path already handles every normal failure mode:

| Symptom | What a plain re-run does |
|---------|--------------------------|
| `--check` reports NEW pages | Creates them from source |
| `--check` reports MOD pages | Clears target content and re-copies |
| `--check` reports RETRY pages (pages with `failedImages` in state) | Per-page force-recopy: re-downloads images via browser, re-uploads, re-writes blocks |
| `--check` reports MISSING pages (target deleted out-of-band) | Auto-heals: recreates the target node in place |
| `--check` reports RENAME | Updates target node title |
| Exit code 1 from previous run due to failed image uploads | Retries the failing pages (they're marked in state) |
| Previous run was killed / crashed / timed out mid-sync | Resumes from last-persisted child; no duplicates |
| Browser session expired, images 403'd | Delete `~/.config/lark-hirono/browser-state.json`, then re-run (fresh login) |

**State is persisted per-child** (`~/.config/lark-hirono/sync-state/<hash>.json`), so interrupting at any point is safe.

### Rule 2: Never present `--force` as a user-facing option

When the user asks "what should I do?" after a failure, do **not** write "Option 1: run with `--force`. Option 2: re-run normally." That framing invites the user to pick `--force` because it sounds more thorough. Instead, prescribe the plain re-run and only mention `--force` if Rule 3 applies.

### Rule 3: `--force` is only correct in two narrow situations

1. The state file at `~/.config/lark-hirono/sync-state/<hash>.json` is genuinely corrupt (unparseable JSON, references target tokens that no longer exist, pairs wrong source and target). Confirm by reading it before reaching for `--force`.
2. The user has explicitly said they want to rebuild the mirror from zero — e.g., "scrap it and start over."

If neither applies, do not use `--force`. It re-downloads every image, re-uploads every block, and does not produce a better result than a plain re-run for any normal failure.

### Rule 4: Exit code 1 is not an emergency

`sync` exits 1 whenever *any* image failed in the current run — even if 99% of the tree synced cleanly and the failures are recoverable on re-run. Exit 1 means "not fully clean yet," not "broken." Treat it as a signal to re-run (Rule 1), not to escalate.

### Rule 5: Orphans are informational, not blocking

`ORPHAN` entries in `--check` mean a source page was deleted or moved out of the subtree. The target node is left intact for the user to delete manually; state is pruned automatically on the next sync. Do not propose `--force` to "clean up" orphans — that would not delete them from the target, it would just rebuild everything around them.

### Rule 6: When truly stuck, read before writing

If re-running doesn't converge after two attempts, do **not** escalate to `--force`. Instead:

1. Run `--check` and read the full report.
2. `cat ~/.config/lark-hirono/sync-state/<hash>.json` and inspect the `pages` entries for the problem children — look at `failedImages`, `contentHash`, `objEditTime`.
3. Run with `-v` and read the log for the specific page that isn't converging.
4. Report the specific finding to the user with a concrete diagnosis, not a generic "try `--force`."

---

## How It Works

### Block-Level Copy

For each child node under the source, the tool:

1. **Creates a new wiki node** under the target via `wiki +node-create`
2. **Fetches all blocks** from the source document via the docx block API
3. **Pre-downloads images** via Playwright browser session (bypasses API 403 on cross-space media)
4. **Reproduces the block tree** via BFS traversal:
   - Batches of 10 blocks created per API call
   - Tables with >9 rows are created at 9 rows then expanded via `insert_table_row`
   - Auto-created children (table cells, grid columns) mapped by position
   - Image data uploaded to empty image blocks, then associated via `replace_image` PATCH (retried up to 2 times with post-upload verification)
5. **Cleans up** auto-created trailing empty paragraphs in callouts and grid columns
6. **Reports failures** — any images that failed to download or upload are logged, included in the sync summary, and recorded in the sync state JSON

This preserves **all** block-level styles: heading backgrounds, table cell colors, callout emojis/borders, paragraph backgrounds, equations, code block languages, nested list indentation.

### Image Transfer

The Feishu media download API often returns 403 for cross-space images. The tool uses Playwright with cached browser session cookies to download images via Feishu's internal CDN:

```
https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/preview/{token}/?preview_type=16
```

On first run, a browser window opens for Feishu login. The session is saved to `~/.config/lark-hirono/browser-state.json` for subsequent headless runs.

### Unsupported Block Types

- **Unknown / internal block types** (e.g. type 999): Cannot be created via API. Skipped with a warning in the sync summary — **content inside these blocks may be lost**; inspect the source doc if the summary reports "Unsupported block types."
- **Shortcuts**: Skipped with a log message.
- **Non-docx nodes** (sheets, bitables): A placeholder docx node is created.

---

## Workflow

### Step 1: Preview the Source Tree

```bash
lark-hirono sync \
  --from https://my.feishu.cn/wiki/SOURCE_TOKEN \
  --to https://my.feishu.cn/wiki/TARGET_TOKEN \
  --dry-run
```

### Step 2: Execute Sync

```bash
lark-hirono sync \
  --from https://my.feishu.cn/wiki/SOURCE_TOKEN \
  --to https://my.feishu.cn/wiki/TARGET_TOKEN \
  -v
```

### Step 3: Verify Sync Is Up to Date

`--check` walks both the source and target trees and compares against
the saved state. It reports what *would* change on the next sync
(new/modified/missing/retry/rename/orphan pages) without performing any
writes. `missing` flags pages whose target was deleted out-of-band —
the next `sync` that touches them will re-create them in place.
Exit status is `0` when fully in sync and `1` when drift is detected,
so it can be used as a CI or pre-publish check.

```bash
lark-hirono sync \
  --from https://my.feishu.cn/wiki/SOURCE_TOKEN \
  --to https://my.feishu.cn/wiki/TARGET_TOKEN \
  --check
```

---

## Examples

### Copy wiki subtree between spaces
```bash
lark-hirono sync \
  --from https://scnajei2ds6y.feishu.cn/wiki/RK4aw2SgriDqDNkB6NLcXhZhnFf \
  --to https://my.feishu.cn/wiki/A770wxopAij0FPktwApceRuPnSe
```

### Dry-run with bare tokens
```bash
lark-hirono sync --from RK4aw2SgriDqDNkB6NLcXhZhnFf --to A770wxopAij0FPktwApceRuPnSe --dry-run
```
