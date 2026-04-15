---
name: lark-hirono-sync
description: >-
  Recursively copy/sync a Feishu wiki subtree from one location to another,
  preserving all block-level styles (heading backgrounds, callouts, text colors,
  table formatting, images) via block-level copy.
  Triggers on: wiki sync, wiki copy, feishu sync, copy wiki tree, sync wiki pages.
compatibility: Requires Node.js 20+, lark-cli >= 1.0.9. Playwright optional for image transfer.
---

# Lark Hirono Sync — Recursive Wiki Subtree Copy

Copy a Feishu wiki subtree from one location to another, preserving all content and block-level styles.

## Running the CLI

1. **Global install** — `lark-hirono sync [options]`
2. **Local dev repo** — `npx tsx bin/lark-hirono.ts sync [options]`

## Prerequisites

- Node.js 20+, `lark-cli` >= 1.0.9 with authentication
- Playwright + Chromium (for image transfer when API returns 403)

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
   - Image data uploaded to empty image blocks, then associated via `replace_image` PATCH
5. **Cleans up** auto-created trailing empty paragraphs in callouts and grid columns

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
