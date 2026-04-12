# CLAUDE.md — AI Assistant Guide for lark-hirono

## Project Overview

**lark-hirono** is a TypeScript CLI tool and library that converts markdown documents into styled Feishu (Lark) documents. It provides heading numbering, table conversion, narrative optimizations, keyword highlighting, and a chunked upload workflow via the `lark-cli` binary.

- **Language**: TypeScript (strict mode), ES modules
- **Runtime**: Node.js 20+
- **Package**: Published to npm as `lark-hirono`
- **License**: MIT
- **External dependency**: `lark-cli` >= 1.0.9 (Feishu CLI for auth and API calls)

## Quick Reference — Commands

```bash
npm run build        # TypeScript compilation → dist/
npm run lint         # ESLint on src/ and bin/
npm test             # 127+ fixture-based dry-run checks (no API calls)
npm run test:upload  # Real upload validation (requires lark-cli auth)
npm run pipeline     # Run pipeline via tsx
npm run preprocess   # Run preprocessor via tsx
```

## Repository Structure

```
bin/
└── lark-hirono.ts         # CLI entry point (subcommand dispatcher)

src/
├── pipeline.ts            # Master orchestration (analyze → normalize → preprocess → upload → patch → verify)
├── cli.ts                 # LarkCli class — thin subprocess wrapper to lark-cli binary
├── config.ts              # Config file resolution (defaults → lark-hirono.json → CLI flags)
├── logging.ts             # Conditional verbose logging
├── index.ts               # Public library exports
├── commands/              # CLI subcommands (each exports a run() function)
│   ├── upload.ts          # Create new styled document from markdown
│   ├── optimize.ts        # Update or clone-then-optimize existing doc
│   ├── fetch.ts           # Retrieve document as markdown
│   ├── analyze.ts         # Classify document structure
│   ├── highlight.ts       # Extract/apply keyword emphasis
│   ├── verify.ts          # Block-level structure validation
│   └── auth.ts            # Feishu authentication
├── core/                  # Transformation modules (pure functions)
│   ├── analyze.ts         # Document classification (narrative|data_table|catalog_table|mixed)
│   ├── normalize.ts       # HTML→Markdown cleanup, callout DSL, quote-container conversion
│   ├── preprocess.ts      # Heading numbering, blue prefix, rainbow backgrounds
│   ├── headings.ts        # Chinese ordinal (一、二、) → numeric conversion
│   ├── narrative.ts       # Narrative doc optimizations (callout injection, code tagging, signpost bolding)
│   ├── lark-table.ts      # Markdown tables → <lark-table> XML with proportional widths
│   ├── latex.ts           # LaTeX normalization and equation tag conversion
│   ├── chunked.ts         # Large doc splitting on H2 boundaries (>40KB sections)
│   └── highlight.ts       # LLM-assisted {red:keyword} emphasis for table titles
├── patch/
│   └── patch.ts           # Block-level PATCH API for heading background colors
├── whiteboard/
│   └── mermaid-patch.ts   # Mermaid diagram whiteboard color patching
├── image/
│   └── images.ts          # Image upload handling
└── verify/
    └── verify.ts          # Block-level structure validation

tests/
├── comprehensive-test.sh  # Main test suite (127+ assertions, bash-based)
├── upload-test.sh         # Real upload tests (requires auth)
├── fixtures/              # Test markdown files
│   ├── comprehensive.md
│   ├── minimal-edge-label-theme.md
│   └── sample-numbered-outline.md
└── highlight-escaped-pipe-test.ts

skills/lark-hirono/        # Claude Code skill integration
```

## Architecture

### Processing Pipeline

Two main workflows:

```
Upload:   Read → Normalize → Analyze → Preprocess → Split → Highlight
          → LarkTable → Upload → Patch → Whiteboard → Verify

Optimize: Fetch → Normalize → Analyze → Narrative → Preprocess → Split
          → LarkTable → Create → Patch → Whiteboard → Verify
```

### Key Abstractions

- **`LarkCli`** (`src/cli.ts`): Subprocess wrapper for the `lark-cli` binary. All Feishu API interactions go through this.
- **`Config`** (`src/config.ts`): Merged configuration (defaults → `lark-hirono.json` → CLI flags).
- **`PipelineArgs` / `PipelineResult`** (`src/pipeline.ts`): Orchestration parameters and return values.
- **Core modules** (`src/core/`): Pure transformation functions. Each takes markdown strings and returns transformed strings. No side effects.

### Module Pattern

Each module is self-contained:
- Internal types defined locally
- Public API exported at bottom
- Heavy use of regex for markdown parsing
- Functional style: pure functions returning new strings/objects

## Code Conventions

### TypeScript

- **Strict mode** enabled (`strict: true` in tsconfig)
- **Target**: ES2022, **Module**: NodeNext
- `noUnusedLocals` and `noFallthroughCasesInSwitch` enforced
- Use `type` imports for type-only imports (`@typescript-eslint/consistent-type-imports`)
- Prefix unused function args with `_` (e.g., `_err`)
- Avoid `any` — use proper types (`@typescript-eslint/no-explicit-any` warns)
- All imports use `.js` extension (NodeNext module resolution)

### Naming

- **camelCase** for functions and variables
- **PascalCase** for types and interfaces
- **kebab-case** for filenames (e.g., `lark-table.ts`, `mermaid-patch.ts`)
- Section separators in source: `// ─── Section Name ──────────`

### Error Handling

- Commands return exit codes (0 = success, 1 = failure)
- Library functions return errors in results rather than throwing (after refactor)
- CLI catches errors and prints to stderr
- Pipeline logs via conditional `log()` in verbose mode only

### No Runtime Dependencies

The project has zero runtime npm dependencies. It uses only:
- Node.js built-in APIs (`node:fs`, `node:path`, `node:child_process`)
- The `lark-cli` binary (invoked as subprocess)

All devDependencies are build-time only (TypeScript, ESLint, tsx).

## Testing

### Running Tests

```bash
npm test                    # Main suite — 127+ dry-run assertions, no API calls
npm run test:upload         # Real upload test — requires lark-cli auth
```

### Test Architecture

- Tests are **bash-based** (`tests/comprehensive-test.sh`), not a JS test framework
- Each test runs the pipeline in `--dry-run` mode and checks stdout for expected patterns
- Fixture markdown files live in `tests/fixtures/`
- Tests verify transformations: heading numbering, table conversion, callout DSL, LaTeX, HTML cleanup, etc.
- No mocking — tests validate the full transformation pipeline on real markdown inputs

### Adding Tests

Add new fixture files to `tests/fixtures/` and add assertion checks in `tests/comprehensive-test.sh` following the existing pattern of `run_test` / `check` / `check_not` helpers.

## Build & Publish

```bash
npm run build               # tsc → dist/ (with .d.ts, sourcemaps)
npm run lint                # ESLint src/ and bin/
```

### CI/CD

- **GitHub Actions** workflow: `.github/workflows/publish.yml`
- Triggered on `v*` tags
- Builds on Node 25, publishes on Node 24
- Validates version tag matches semver, runs build + test before `npm publish --access public`

### Publishing

1. Update version in `package.json`
2. Push a `v<version>` tag (e.g., `v0.1.15`)
3. CI validates, builds, tests, and publishes to npm

## Configuration

`lark-hirono.json` (discovered by walking up from cwd to `.git` root):

```json
{
  "wikiSpace": "string",
  "wikiNode": "string",
  "bgMode": "light|dark",
  "highlight": true,
  "stripTitle": false,
  "imageDir": "string|null"
}
```

Resolution order: CLI flags > config file > built-in defaults.

This file is `.gitignore`d (may contain real workspace IDs).

## Known Feishu/lark-cli Quirks

These are platform limitations that affect code design:

- **`#` in table cells**: `#` at line start creates a heading even inside `<lark-td>`. Pipeline inserts zero-width space (U+200B) before `#`.
- **`***bold-italic***` with underscores**: Any `_` inside `***...***` causes lark-cli to strip bold. Use backtick code format for metric names with underscores.
- **`<quote-container>` is fetch-only**: lark-cli emits it when fetching but silently drops it on upload. Pipeline converts to `<callout>` (in tables) or blockquote `>` (elsewhere).
- **LaTeX protection**: `\mkern0mu` inserted after `}` before subscript `_` to prevent italic parsing.
- **Markdown export corruption**: Feishu export mangles plain text as headings, merges paragraphs, strips code block languages. Verify uses block-level API, not export.

## Working with the Code

### Making Changes to Transformations

1. Edit the relevant module in `src/core/`
2. Add a test fixture or assertion in `tests/comprehensive-test.sh`
3. Run `npm test` to validate
4. Run `npm run lint` to check style
5. Run `npm run build` to ensure compilation succeeds

### Adding a New CLI Command

1. Create `src/commands/<name>.ts` exporting a `run()` function
2. Register it in `bin/lark-hirono.ts` subcommand dispatcher
3. Add tests in `tests/comprehensive-test.sh`

### Library Usage

The package exports three entry points:
- `lark-hirono` — Core transformation functions (analyze, normalize, preprocess, etc.)
- `lark-hirono/pipeline` — Full pipeline orchestration
- `lark-hirono/cli` — LarkCli wrapper class
