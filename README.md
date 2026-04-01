# feishu-custom

Feishu doc creation pipeline with heading numbering, rainbow backgrounds, block-level styling, and full upload workflow.

## Quick Start

```bash
# Install
pnpm install

# Analyze a markdown file
pnpx tsx src/pipeline.ts input.md "Title" --analyze

# Dry-run preprocess
pnpx tsx src/pipeline.ts input.md "Title" --dry-run

# Create doc with full verification
pnpx tsx src/pipeline.ts input.md "Title" --wiki-space my_library --strip-title --verify -v
```

## Options

| Flag | Description |
|------|-------------|
| `--wiki-node TOKEN` | Target wiki node (default: Hirono Wiki > Testing) |
| `--wiki-space ID` | Target wiki space (default: Hirono Wiki) |
| `--strip-title` | Remove first H1, use it as document title |
| `--bg-mode light\|dark` | Heading background palette (default: `light`) |
| `--analyze` | Run analysis only (classify document, suggest modules) |
| `--verify` | Fetch-back and verify after creation |
| `--dry-run` | Preprocess only, no API calls |
| `-v, --verbose` | Verbose output |

## Architecture

```
src/
├── pipeline.ts    Main orchestration: analyze → normalize → preprocess → create → patch → verify
├── cli.ts         Lark CLI wrapper (auth + API calls via lark-cli)
├── analyze.ts     Document classification (narrative/data_table/catalog_table)
├── normalize.ts   Markdown cleanup (table separators, lint, HTML detection)
├── preprocess.ts  Blue numbering prefix, heading attribute cleanup
├── patch.ts       Heading background PATCH (rainbow, shifted by depth)
├── verify.ts      Fetch-back regression verification
└── images.ts      Image download/upload (remote → Feishu blocks)
```

### Upload Workflow

1. **Analyze** — classify document type, detect tables/categories, suggest optimization modules
2. **Normalize** — clean markdown (table separators, duplicate metadata, lint warnings)
3. **Preprocess** — blue numbering prefix, strip `{color=...}` attributes
4. **Create** — `lark-cli docs +create` with preprocessed markdown
5. **Patch** — detect heading blocks, compute rainbow backgrounds (shifted by actual heading depth), PATCH via `lark-cli api`
6. **Verify** — fetch blocks back, check heading bg coverage, row counts

### Auth

Auth is managed entirely by `lark-cli`. Login once:

```bash
lark-cli auth login --domain docs
```

The pipeline reads auth status and uses the CLI for all API calls.

### Rainbow Colors

Heading backgrounds shift based on actual heading depth in the body:

| Depth | Light mode | Dark mode |
|-------|-----------|-----------|
| Top | LightRed | DarkRed |
| +1 | LightOrange | DarkOrange |
| +2 | LightYellow | DarkYellow |
| +3 | LightGreen | DarkGreen |
| +4 | LightBlue | DarkBlue |

When the document title is stripped (`--strip-title`), the top-level body heading gets LightRed, and the rainbow cascades from there.

## Design Docs

See `design/` for detailed design decisions and verified syntax.
