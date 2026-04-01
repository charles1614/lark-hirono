# feishu-custom

Markdown → Feishu (Lark) document pipeline. Converts markdown to styled Feishu documents with heading numbering, table conversion, and upload workflow.

## Features

- **Normalize** — HTML → Markdown, table separators, escaped pipes, heading number normalization
- **Heading numbering** — Blue number prefix with rainbow background per level
- **Chinese ordinals** — `一、二、` → `1. 2.` auto-convert
- **Table conversion** — Markdown tables → `<lark-table>` with rich text support (bold, italic, code, colors, lists in cells)
- **HTML cleanup** — `<p>`, `<strong>`, `<a>`, `<ul>/<li>` → clean Markdown
- **Highlight** — Keyword-based `{red:**text**}` highlighting
- **Upload** — Create docs via `lark-cli`, block-level PATCH for heading backgrounds
- **Verify** — Fetch-back regression testing

## Install

```bash
pnpm install

# Auth (once)
lark-cli auth login --domain docs
```

## Usage

```bash
# Dry-run (no API calls, stdout output)
npx tsx src/pipeline.ts input.md "Title" --dry-run --no-highlight

# Full upload with verification
npx tsx src/pipeline.ts input.md "Title" --wiki-space 7620053427331681234 --verify -v

# Strip first H1 as document title
npx tsx src/pipeline.ts input.md --strip-title
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preprocess only, output to stdout |
| `--no-highlight` | Skip keyword highlighting |
| `--strip-title` | Remove first H1, use as doc title |
| `--bg-mode light\|dark` | Heading background palette |
| `--wiki-space ID` | Target wiki space |
| `--wiki-node TOKEN` | Target wiki node |
| `--verify` | Fetch-back verification after upload |
| `-v, --verbose` | Verbose logging |

## API

```ts
import {
  normalizeMarkdown,
  preprocessMarkdown,
  convertToLarkTables,
  unescapePipes,
  splitInlineBullets,
  boldTableHeaders,
} from "feishu-custom";

// Full pipeline (no upload)
const { text } = normalizeMarkdown(rawMarkdown);
const preprocessed = preprocessMarkdown(text);
const withTables = convertToLarkTables(preprocessed);
const final = splitInlineBullets(unescapePipes(withTables));
```

### Modules

| Module | Description |
|--------|-------------|
| `normalize` | HTML→md, table separators, heading numbers, escaped pipes |
| `preprocess` | Blue number prefix, heading `{color}` cleanup |
| `lark-table` | Markdown tables → `<lark-table>` XML |
| `headings` | Chinese ordinal normalization, duplicate fix |
| `highlight` | Keyword extraction, batch processing, apply |
| `chunked` | Large doc splitting |
| `patch` | Heading background block-level PATCH |
| `verify` | Fetch-back regression checks |
| `cli` | Lark CLI wrapper (`lark-cli` subprocess) |
| `analyze` | Document type classification |

## Pipeline

```
Source → Normalize → Analyze → Lint → Preprocess → Lark-table → Unescape → Split → Upload → Patch → Verify
```

1. **Normalize** — clean markdown (HTML tags, table separators, heading numbers)
2. **Analyze** — classify document type
3. **Preprocess** — blue numbering, attribute cleanup
4. **Lark-table** — convert markdown tables to `<lark-table>` XML
5. **Unescape** — `\|` → `|` inside lark-table cells
6. **Upload** — create doc via `lark-cli`
7. **Patch** — heading background colors via API
8. **Verify** — fetch-back regression testing

## Tests

```bash
# Dry-run tests (62 checks, no API)
pnpm test

# Upload tests (17 checks, creates real doc)
pnpm run test:upload
```

Test fixture covers: headings, inline rich text, lists, callouts, code/equations, HTML→markdown, simple/strict/HTML/RW tables, Chinese ordinals, escaped pipes, grid, edge cases, highlight tags.

## License

MIT
