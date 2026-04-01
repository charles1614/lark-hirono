# feishu-custom

Markdown → Feishu (Lark) document pipeline. Converts markdown tables with embedded HTML semantics to styled Feishu documents.

## Features

- **Normalize** — HTML → Markdown (`<p>`, `<ul>`, `<li>`, `<strong>`, `<a>`, `<br>`, `<em>`, `<i>`, `<b>`). `<li>` converts to `- ` list items. `<br>` converts to newlines in cells.
- **Heading numbering** — Blue number prefix with rainbow background per heading level
- **Chinese ordinals** — `一、二、` → `1. 2.` auto-convert
- **Table conversion** — Markdown tables → `<lark-table>` XML with smart proportional column widths
- **Highlight** — Keyword-based red highlighting for table titles
- **Upload** — Chunked doc creation via `lark-cli`, block-level PATCH for heading backgrounds
- **Verify** — Fetch-back regression testing

## Install

```bash
pnpm install
lark-cli auth login --domain docs
```

## Usage

```bash
# Dry-run (preprocess only)
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

## Pipeline

```
Source → Normalize → Analyze → Lint → Preprocess → Split → Highlight
     → Bold Headers → Lark-table → Unescape → Upload → Patch → Verify
```

1. **Normalize** — `<p>`/`<ul>`/`<li>`/`<strong>`/`<a>` → clean Markdown
2. **Analyze** — classify document type
3. **Preprocess** — heading numbering, strip attributes
4. **Split** — oversized sections (>40KB) into chunks
5. **Highlight** — apply LLM-selected keywords as `<text color="red">`
6. **Bold Headers** — table header cells wrapped in `**`
7. **Lark-table** — convert markdown tables to `<lark-table>` XML
8. **Upload** — create doc via chunked API
9. **Patch** — heading background colors
10. **Verify** — fetch-back checks

## Tests

```bash
# Dry-run tests (73 checks, no API)
pnpm test

# Upload tests (17 checks, creates real doc)
pnpm run test:upload
```

## Architecture

```
src/
├── pipeline.ts    Main orchestration
├── cli.ts         Lark CLI auth/API wrapper
├── analyze.ts     Document classification
├── normalize.ts   HTML→Markdown cleanup
├── preprocess.ts  Heading numbering, strip-title
├── lark-table.ts  Table → XML conversion, column width algorithm
├── patch.ts       Heading background PATCH
├── verify.ts      Fetch-back regression checks
└── highlight.ts   Keyword-based highlighting
```

## License

MIT
