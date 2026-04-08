# lark-hirono

Markdown → Styled Feishu (Lark) documents with heading numbering, table conversion, and narrative optimizations.

## Features

- **Subcommand CLI** — `upload`, `optimize`, `fetch`, `analyze`, `highlight`, `verify`, `auth`
- **Document types** — Automatic analysis: `catalog_table`, `data_table`, `narrative`, `mixed`
- **Heading styling** — Blue number prefix + rainbow backgrounds per level
- **Chinese ordinals** — `一、二、` → `1. 2.` auto-convert
- **Table conversion** — Markdown tables → `<lark-table>` XML with proportional widths
- **Keyword highlighting** — LLM-assisted `{red:keyword}` for table titles
- **Narrative optimizations** — Callout injection, code block tagging, signpost bolding
- **Chunked upload** — Large docs (>200KB) split automatically
- **Verify** — Block-level structure validation

## Install

### CLI (npm)

Requires Node.js 20+ and the Feishu CLI dependency used by `lark-hirono`.
After the package is published to npm, install the latest release with:

```bash
npm install -g lark-hirono@latest
```

### Install `lark-cli`

`lark-hirono` shells out to `lark-cli` for auth, document APIs, and uploads. Install it first if you do not already have it:

```bash
mkdir -p /tmp/larkcli
cd /tmp/larkcli
npm init -y
npm install @larksuite/cli
node node_modules/@larksuite/cli/scripts/install.js
```

### Claude Code Skill

```bash
npx skills add charles1614/lark-hirono
```

Then use `/lark-hirono` in Claude Code. See [`skills/lark-hirono/SKILL.md`](skills/lark-hirono/SKILL.md) for action reference.

### Local Development

```bash
corepack enable
corepack prepare pnpm@10.18.3 --activate
pnpm install
```

### Authentication

Before using the CLI or skill, authenticate with Feishu:

```bash
lark-cli auth login --domain docs
```

## Usage

### Upload Local Markdown

```bash
lark-hirono upload input.md --title "My Document" --verify
```

### Optimize Existing Document

Create optimized sibling (recommended):
```bash
lark-hirono optimize --doc GzlQwunV9iQAqmkQqOBcZzugnjf --new --verify
```

Update in-place (not recommended due to Feishu export corruption):
```bash
lark-hirono optimize --doc GzlQwunV9iQAqmkQqOBcZzugnjf --verify
```

### Fetch Document as Markdown

```bash
lark-hirono fetch --doc GzlQwunV9iQAqmkQqOBcZzugnjf --output out.md
```

### Analyze Document Type

```bash
lark-hirono analyze input.md
# Output: {"document_type": "narrative", "headings": 15, "tables": "0/0"}
```

### Verify Existing Document

```bash
lark-hirono verify --doc GzlQwunV9iQAqmkQqOBcZzugnjf
```

## Commands

| Command | Description |
|---------|-------------|
| `upload <file.md>` | Create new styled Feishu document |
| `optimize --doc <id>` | Optimize existing document |
| `fetch --doc <id>` | Retrieve document as markdown |
| `analyze <file.md>` | Analyze document structure |
| `highlight <subcommand>` | Extract/apply keyword highlights |
| `verify --doc <id>` | Validate document structure |
| `auth <subcommand>` | Feishu authentication |

### Common Flags

| Flag | Description |
|------|-------------|
| `--doc <id>` | Feishu document ID |
| `--new` | Create sibling doc instead of updating |
| `--input <file>` | Local markdown source |
| `--title <title>` | Document title |
| `--wiki-space <id>` | Target wiki space |
| `--wiki-node <token>` | Target parent node |
| `--bg-mode light\|dark` | Heading background palette |
| `--verify` | Validate after upload/optimize |
| `--no-highlight` | Skip keyword highlighting |
| `--dry-run` | Output to stdout, no API calls |
| `-v, --verbose` | Detailed logging |

## Pipeline

```
Upload:   Read → Normalize → Analyze → Preprocess → Split → Highlight
          → LarkTable → Upload → Patch → Verify

Optimize: Fetch → Normalize → Analyze → Narrative → Preprocess → Split
          → LarkTable → Create → Patch → Verify
```

### Key Steps

1. **Normalize** — HTML (`<p>`, `<ul>`, `<li>`, `<strong>`, `<a>`) → clean Markdown
2. **Analyze** — Classify document type based on table count and heading density
3. **Narrative** — For narrative docs: callout injection, code block tagging, signpost bolding
4. **Preprocess** — Heading numbering, strip title, blue prefix + rainbow backgrounds
5. **Split** — Oversized sections (>40KB) into chunks for API limits
6. **Highlight** — Apply `{red:keyword}` from LLM-selected keywords (table docs only)
7. **LarkTable** — Markdown tables → `<lark-table>` XML
8. **Upload/Create** — Chunked doc creation via `lark-cli`
9. **Patch** — Block-level PATCH for heading backgrounds
10. **Verify** — Structure validation (block-level, not markdown export)

## Narrative Optimizations

For `documentType === "narrative"` (≥3 headings, no tables):

- **Opening callout** — Inject `[!callout icon=bulb]` with first paragraph as description
- **Code block tagging** — Detect `bash`, `nginx`, `yaml`, `python` from content patterns
- **Blockquote conversion** — TL;DR and summary phrases → callout format
- **Signpost bolding** — Emphasize transition phrases (`具体来说`, `值得注意的是`)
- **Chatbot tail stripping** — Remove LLM artifact text from end of fetched docs

## Config File

`lark-hirono.json` in current directory or ancestors:

```json
{
  "wikiSpace": "7620053427331681234",
  "wikiNode": "UNtHwabqNiqc8ZkzvLscWNnwnYd",
  "bgMode": "light",
  "highlight": true
}
```

Priority: CLI flags → config file → built-in defaults.

## Tests

```bash
npm test  # 92 checks, all local file-based
```

## Architecture

```
src/
├── pipeline.ts          # Master orchestration
├── cli.ts               # Lark CLI wrapper (auth, API calls)
├── config.ts            # Config file resolution
├── commands/            # CLI subcommands
│   ├── upload.ts
│   ├── optimize.ts
│   ├── fetch.ts
│   ├── analyze.ts
│   ├── highlight.ts
│   ├── verify.ts
│   └── auth.ts
├── core/
│   ├── analyze.ts       # Document classification
│   ├── normalize.ts     # HTML→Markdown cleanup
│   ├── preprocess.ts    # Heading numbering, strip-title
│   ├── narrative.ts     # Narrative doc optimizations
│   ├── headings.ts      # Chinese ordinal conversion
│   ├── lark-table.ts    # Table → XML conversion
│   ├── chunked.ts       # Large doc splitting
│   └── highlight.ts     # Keyword highlighting
├── patch/
│   └── patch.ts         # Heading background PATCH
├── image/
│   └── images.ts        # Image upload
└── verify/
    └── verify.ts        # Structure validation
```

## Limitations

### Feishu Markdown Export Corruption

`lark-cli docs +fetch` does not faithfully round-trip markdown:
- Plain text blocks exported as `##` headings
- Consecutive paragraph lines merged (blank lines lost)
- Code block language tags stripped (`bash` → `plaintext`)
- Callout format simplified (blank lines removed)

**Mitigation:** Verify uses block-level structure (accurate), not markdown export (corrupted).

### LLM Content Emphasis Not Automated

The optimization guide requires LLM judgment for:
- `{red:关键结论}` — identifying key conclusions
- `{green:技术术语}` — identifying technical terms
- Insight callouts — content understanding

These are **not automated** in the pipeline. Use the skill layer (`skills/lark-hirono/SKILL.md`) for LLM-assisted content optimization.

## License

MIT
