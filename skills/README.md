# lark-hirono Skills

Document optimization skills following the "code for components, skills for pipeline" pattern.

## Available Skills

### [lark-hirono-optimize](./lark-hirono-optimize/SKILL.md)

Main optimization pipeline for narrative documents.

**Workflow**: Normalize → Headings → Callout → Emphasis (optional) → Verify

**Usage**:
```bash
# Deterministic (zero LLM cost)
lark-hirono optimize --doc <id> --new

# With LLM emphasis
lark-hirono optimize --doc <id> --new
# Then run emphasis workflow separately
```

### [lark-hirono-emphasize](./lark-hirono-emphasize/SKILL.md)

LLM-assisted emphasis for key conclusions and technical terms.

**Workflow**: Extract candidates → LLM selection → Apply emphasis

**Usage**:
```bash
# Extract candidates (deterministic)
npx tsx -e "..." # see skill for full command

# LLM selection (manual)
# Run LLM on generated JSON files

# Apply emphasis (deterministic)
npx tsx -e "..." # see skill for full command
```

## Architecture Pattern

```
src/core/           # Deterministic components (no LLM)
  normalize.ts      # Markdown normalization
  headings.ts       # Heading renumbering
  narrative.ts      # Callout injection, emphasis helpers
  verify.ts         # Quality checks

skills/             # Pipeline orchestration (may use LLM)
  lark-hirono-optimize/     # Main workflow
  lark-hirono-emphasize/    # LLM emphasis workflow
```

**Principle**: 
- **Code** = Components (deterministic, testable, zero cost)
- **Skills** = Pipeline (orchestration, may use LLM, higher cost)

## Cost Comparison

| Skill | LLM Required | Cost Range |
|-------|--------------|------------|
| optimize (deterministic) | No | Zero |
| optimize + emphasize | Yes | ~$0.10-0.50/doc |

## Development

To add a new skill:

1. Create `skills/<skill-name>/SKILL.md`
2. Document workflow, usage, cost
3. Reference deterministic components from `src/core/`
4. If LLM needed, document prompt templates and expected output

## See Also

- [OpenCLI Skills Pattern](https://github.com/jackwener/opencli) — Reference implementation
- `src/core/` — Deterministic components
- `src/verify/` — Quality assurance
