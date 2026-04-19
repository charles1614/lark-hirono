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
| All images fail after first failure | `_browserFailed` flag set for process lifetime | Fix the underlying browser issue and re-run the sync command |
| Image upload failures in summary | Upload API failed or verification found empty token | Re-run sync with `--force` to retry; failures are auto-retried (2 attempts) with verification |

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
- `--to <url>` — Target wiki URL or bare node token; children created under this node (required)
- `--no-numbers` — Skip auto-numbered headings (numbering enabled by default)
- `--browser-state <path>` — Path to Playwright browser state file (default: `~/.config/lark-hirono/browser-state.json`)
- `--dry-run` — Print source tree structure without copying
- `--check` — Read-only diff of source vs saved state; also walks the target tree to detect pages deleted out-of-band. Reports new/modified/missing/retry/rename/orphan pages. Exit `0` if fully in sync, `1` if drift detected (usable as a CI check). Pages flagged `missing` are auto-recreated by the next `sync` that touches them.
- `--status` — Print saved-state metadata only (last sync time, tracked page count); offline, no API calls
- `--force` — Ignore saved state, force full re-sync
- `-v, --verbose` — Verbose logging

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

- **Type 999** (Feishu internal): Cannot be created via API. Skipped with no content loss.
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
