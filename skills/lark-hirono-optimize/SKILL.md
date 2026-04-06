---
name: lark-hirono-optimize
description: Transform narrative documents for Feishu. Normalize markdown, fix headings, inject callouts, add emphasis. Supports deterministic-only or LLM-enhanced modes.
allowed-tools: Bash(npx tsx:*), Read, Write
---

# lark-hirono-optimize — Document Optimization Pipeline

Transform markdown documents for Feishu rendering with optional LLM enhancement.

## Workflow

1. **Normalize** — Fix table separators, clean HTML, normalize headings
2. **Headings** — Convert Chinese ordinals, renumber sequentially
3. **Callout** — Inject opening callout with description
4. **Emphasis** (optional) — Add `{red:...}` and `{green:...}` via LLM
5. **Verify** — Check output quality

## Usage

### Deterministic Pipeline (Default)

```bash
# Optimize from local file
npx tsx src/cli.ts optimize --input input.md --output output.md

# Optimize from Feishu doc ID
lark-hirono optimize --doc <doc-id> --new
```

### With LLM Emphasis (Manual Workflow)

```bash
# Step 1: Run deterministic pipeline
lark-hirono optimize --doc <doc-id> --new

# Step 2: Extract emphasis candidates (if emphasis skill available)
npx tsx -e "
import { extractEmphasisCandidates, saveEmphasisBatches } from './src/core/narrative.js';
import { readFileSync } from 'fs';
const md = readFileSync('output.md', 'utf-8');
const batches = extractEmphasisCandidates(md);
saveEmphasisBatches(batches, 'output.md');
"

# Step 3: Run LLM on generated JSON files (see lark-hirono-emphasize skill)
# Step 4: Apply emphasis
npx tsx -e "
import { applyEmphasis } from './src/core/narrative.js';
import { readFileSync, writeFileSync } from 'fs';
const md = readFileSync('output.md', 'utf-8');
const selections = JSON.parse(readFileSync('output.selected_keywords.json', 'utf-8'));
const result = applyEmphasis(md, selections);
writeFileSync('output-final.md', result, 'utf-8');
"
```

## Pipeline Steps

### 1. Normalize Markdown

**Deterministic** — Zero LLM cost

Fixes:
- Table separator spacing: `| --- |` → `|---|`
- HTML tags: `<br>`, `<p>`, `<li>` → markdown equivalents
- Paragraph breaks: Add blank lines between consecutive text lines
- Duplicate metadata: Remove repeated `<!-- metadata -->` blocks

Code: `src/core/normalize.ts`

### 2. Normalize Headings

**Deterministic** — Zero LLM cost

Transforms:
- Chinese ordinals: `## **一、端口规划**` → `## 1. **端口规划**`
- Out-of-sequence: `## 4.3 Title` → `## 3. Title`
- Missing numbers: Keep as-is (no number added)

Code: `src/core/headings.ts`

### 3. Inject Opening Callout

**Deterministic** — Zero LLM cost

Extracts first paragraph → Lark callout block:
```markdown
> [!callout icon=bulb bg=2 border=2]
> 下面是一份适合你保存的**部署备忘录**。
```

Code: `src/core/narrative.ts`

### 4. Add Emphasis (Optional)

**LLM-required** — Cost depends on document size

See `skills/lark-hirono-emphasize/SKILL.md` for full workflow.

Two-phase approach:
- **Extraction** (deterministic): Find candidate sentences
- **Selection** (LLM): Identify key conclusions (red) and technical terms (green)

Code: `src/core/narrative.ts`
Skill: `skills/lark-hirono-emphasize/SKILL.md`

### 5. Verify Output

**Deterministic** — Zero LLM cost

Checks:
- Headings numbered sequentially
- No Chinese ordinals remaining
- No duplicate paragraph in callout
- Table headers bolded

Code: `src/verify/verify.ts`

## Cost Guide

| Mode | Steps | LLM Cost |
|------|-------|----------|
| Deterministic | Normalize + Headings + Callout | Zero |
| LLM-enhanced | All steps + Emphasis | ~$0.10-0.50 per doc |

## Integration with lark-hirono CLI

This skill is the primary entry point for document optimization:

```bash
# Create optimized sibling doc
lark-hirono optimize --doc <id> --new

# Optimize local file
lark-hirono optimize --input input.md --output output.md
```

The CLI automatically:
1. Fetches doc content (if `--doc` provided)
2. Runs deterministic pipeline
3. Uploads result (if `--new` flag)
4. Returns doc ID or saves to file

## Architecture Pattern

Following opencli structure:

```
src/core/           # Deterministic components (no LLM)
  normalize.ts      # Markdown normalization
  headings.ts       # Heading renumbering
  narrative.ts      # Callout injection, emphasis helpers

skills/             # Pipeline orchestration (may use LLM)
  lark-hirono-optimize/SKILL.md     # Main workflow
  lark-hirono-emphasize/SKILL.md    # LLM emphasis workflow
```

**Principle**: Code = Components (deterministic), Skills = Pipeline (can use LLM)

## Example

Input:
```markdown
## **一、端口规划**

- 80/tcp → Nginx
- 443/tcp → Nginx
- 443/udp → Hysteria

说明：Nginx 和 Hysteria 不冲突。
```

Output:
```markdown
> [!callout icon=bulb bg=2 border=2]
> 说明：Nginx 和 Hysteria 不冲突。

## <text color="blue">1 </text>**端口规划**

- 80/tcp → Nginx
- 443/tcp → Nginx
- 443/udp → Hysteria
```

## Quality Assurance

Run verification after optimization:

```bash
npx tsx src/cli.ts verify output.md
```

For narrative docs, verification checks:
- Heading numbers present and sequential
- No Chinese ordinals in numbered headings
- Callout present in first 20 lines
- No duplicate opening paragraph

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Chinese ordinals not converted | Check if heading has bold markers (`**一、**`) — handled in v2 |
| Paragraph breaks missing | Heuristic looks for lines <80 chars ending without punctuation |
| Callout not injected | First paragraph must be plain text (not heading/list) |
| Feishu export corrupted | Known issue with Feishu API — cannot fix on our side |
