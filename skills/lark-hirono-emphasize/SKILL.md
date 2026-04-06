---
name: lark-hirono-emphasize
description: Add LLM-selected emphasis to narrative documents. Extract candidate sentences, use LLM to identify key conclusions (red) and technical terms (green), apply emphasis.
allowed-tools: Bash(npx tsx:*), Read, Write
---

# lark-hirono-emphasize — LLM-Assisted Content Emphasis

Add `{red:...}` and `{green:...}` emphasis to narrative documents using LLM judgment.

## Workflow

1. **Extract candidates** — deterministic code finds sentences matching patterns
2. **LLM selection** — identify key conclusions and technical terms
3. **Apply emphasis** — wrap selected text with color markers

## Usage

```bash
# Extract candidates from document
npx tsx -e "
import { extractEmphasisCandidates, saveEmphasisBatches } from './src/core/narrative.js';
import { readFileSync } from 'fs';
const md = readFileSync('input.md', 'utf-8');
const batches = extractEmphasisCandidates(md);
saveEmphasisBatches(batches, 'input.md');
console.log('Saved batches:', batches.length);
"

# Review generated files
ls input.md.emphasis_batch_*.json

# After LLM selection, apply results
npx tsx -e "
import { applyEmphasis } from './src/core/narrative.js';
import { readFileSync, writeFileSync } from 'fs';
const md = readFileSync('input.md', 'utf-8');
const selections = JSON.parse(readFileSync('input.selected_keywords.json', 'utf-8'));
const result = applyEmphasis(md, selections);
writeFileSync('output.md', result, 'utf-8');
"
```

## Candidate Extraction Rules

Code extracts sentences matching these patterns:

**Red emphasis candidates** (key conclusions):
- Contains conclusion words: 降低, 提升, 优化, 改善, 减少, 增加, 实现, 完成
- Follows: 于是, 因此, 所以

**Green emphasis candidates** (key concepts):
- Contains: 架构, 设计, 方案, 原理, 机制, 算法, 模型
- Followed by: 核心, 关键, 重要, 主要

## LLM Selection Prompt

Present candidates to LLM with this prompt:

```
For each paragraph, identify text that should have emphasis:

1. **Red emphasis** {red:text} — Key conclusions, results, or important claims
   - Concluding sentences with concrete results
   - Must-not-miss facts
   - Peak performance numbers

2. **Green emphasis** {green:text} — Technical terms on first mention
   - System/component names
   - Key technical concepts
   - Algorithm/model names

Format your response as JSON:
```json
[
  {
    "paragraphIndex": 0,
    "emphasis": "This is the {red:key conclusion} for this paragraph."
  },
  {
    "paragraphIndex": 5,
    "emphasis": "The {green:FlashAttention} algorithm achieves 2x speedup."
  }
]
```

Candidates:
[Insert candidate paragraphs here]
```

## Output Format

After LLM selection, save as `input.selected_keywords.json`:

```json
[
  {
    "index": 12,
    "emphasis": "最终方案是：{red:Nginx 管 TCP 网站和证书，Hysteria 管 UDP 443}"
  },
  {
    "index": 45,
    "emphasis": "{green:Hysteria} 以 User=hysteria 运行"
  }
]
```

## Integration with Pipeline

This skill is **optional** in the optimize workflow:

```bash
# Deterministic optimize (no LLM)
lark-hirono optimize --doc <id> --new

# With LLM emphasis (manual workflow)
lark-hirono optimize --doc <id> --new --extract-emphasis
# ... run LLM on generated JSON files ...
lark-hirono optimize --doc <id> --new --apply-emphasis selections.json
```

## Cost

- **Extraction**: Zero cost (deterministic code)
- **LLM selection**: Depends on document size (typically 50-200 candidates)
- **Application**: Zero cost (deterministic code)
