# Format Optimization Guide

## Known Reference Format Pattern

The following conventions were observed across multiple well-formatted reference documents (GLM-5 技术报告解读, YaRN 代码解读, Qwen-3.5 Preview). Use these as the **target format** when optimizing:

### Opening Callout

Every document starts with a `[!callout]` block containing:
- An appropriate icon (e.g. `gift`, `bulb`, `bookmark`, `pushpin`, `rocket`, `star`)
- **Paper/resource links**: Paper title linked to arXiv/publication, GitHub repo link
- **Related doc links**: Cross-references to related wiki pages

Example:
```markdown
> [!callout icon=gift bg=2 border=2]
> 本文档介绍 FlashAttention 的核心思想与实现细节。
>
> **Paper**: [FlashAttention: Fast and Memory-Efficient Exact Attention](https://arxiv.org/abs/2205.14135)
>
> **Code**: [GitHub](https://github.com/Dao-AILab/flash-attention)
>
> **Related**: [FlashAttention-2 解读](link), [Memory-Efficient Attention](link)
```

### Numbered Headings

Sections use explicit numbering in the heading text — **all three levels must be numbered**:
- `## 1 第一节标题` (top-level sections)
- `### 1.1 子节标题` (second-level subsections)
- `### 1.2 另一个子节` (next subsection)
- `#### 1.1.1 三级子节` (third-level subsections)
- `#### 1.1.2 另一个三级子节` (next third-level)
- `## 2 第二节标题` (next top-level)

Numbers are part of the heading text, not auto-generated. Ensure numbering is sequential with no duplicates. **If any `##` heading is numbered, all `###` children must also be numbered, and all `####` grandchildren must also be numbered.** Never leave a heading level unnumbered when its parent level is numbered.

### Callout Blocks for Key Concepts

Use callout blocks and blockquotes **freely throughout the document** wherever content benefits from visual separation. There is no upper limit — use as many as the content warrants.

Forms available:
- `> 📌 **标题**: ...` — key insight, critical fact, must-not-miss design decision
- `> 📚 **背景**: ...` — background knowledge or prerequisites
- `[!callout icon=bulb bg=2 border=2]` — **blue callout** for TL;DR / section-opening summaries (use this, NOT `|>`)
- `[!callout icon=pushpin bg=3 border=3]` — **green callout** for "一句话总结" / "一句话定位" / "核心思想" (use this, NOT `|>`)
- `[!callout icon=X bg=N border=N]` — Feishu-native callout box for document-opening summary
- `|>` quote container — other key insights, observations, comparisons
- `> plain blockquote` — any observation, comparison, or summary that benefits from visual grouping

When to use:
- Counterintuitive design decisions and the reasoning behind them
- Critical constraints or caveats readers must not miss
- "Why does this work" explanations that could be glossed over
- Any important conclusion or result that should stand out visually
- Section-internal summaries, comparisons, observations

**Density guideline**: A long technical document (20+ sections) should have **5–15 callout/blockquote instances** spread throughout. If the document has fewer than 5 visual call-outs, you are being too conservative. Wrap `> TL;DR:` blocks, "一句话定位/总结" paragraphs, and key design insight paragraphs.

Example:
```markdown
> 📌 **核心思想**: Tiling + recomputation，用计算换IO，减少HBM访问
```

### Code Blocks with Language Tags

All code blocks specify a language tag: ` ```python `, ` ```cpp `, ` ```bash `, etc. Never use bare ` ``` `.

### LaTeX Equations

Mathematical formulas use LaTeX syntax. Inline: `$O(N^2)$`. Display:
```
$$
S = QK^T \in \mathbb{R}^{N \times N}
$$
```

### Cross-Links

References to other wiki documents use inline markdown links with descriptive text, not raw URLs.

### Section Separators

Major sections are separated by horizontal rules (`---`).

---

## Analysis Framework

When comparing source and reference documents, work through these dimensions systematically.

## 1. Heading Structure

| Check | What to look for |
|-------|-----------------|
| Numbering | Does source use `## 1`, `### 1.1`, `#### 1.1.1` pattern at all three levels? Are numbers sequential and continuous? |
| Depth | Does source match reference's hierarchy depth? |
| Duplicates | Any duplicate section numbers (e.g., two `## 5` sections)? |
| Group resets | Does numbering restart in multiple places (first `## 1, 2, 3`, then another `## 1, 2, 3`)? |
| Level conflicts | Is any group/chapter heading at the same level as the sub-items it introduces? |

**When to adjust**: Fix duplicate or reset numbering. Elevate group headers that sit at the wrong level. Add numbers if reference uses them and source doesn't.

**When NOT to adjust**: Don't merge or split sections, don't change what each section covers.

### Heading Group Conflicts

A document has a **heading group conflict** when:
- Multiple sibling headings each restart internal numbering: first `## 1, ## 2, ## 3`, then another `## 1, ## 2, ## 3`
- A "chapter title" heading is at the same markdown level as the sub-sections it introduces

**Fix strategy (choose one):**
1. **Elevate the group header**: if a heading like `## 深度推导：…` logically contains `## 1`, `## 2`, `## 3` sub-items, promote it to `#` and convert sub-items to `##`
2. **Continuous renumber**: if there is no clear group header, renumber all headings sequentially without resets

**Renaming**: when restructuring, you may revise heading titles to accurately reflect the section's actual scope — keep the core topic, improve precision only.

**Reordering**: move sections when a prerequisite concept appears after the concept that depends on it, or when closely related topics are scattered. Note every reorder in the summary report.

## 2. Opening Structure

| Check | What to look for |
|-------|-----------------|
| Opening callout | Does source have a 📌 callout with paper/repo links? |
| Paper links | Are arXiv/publication links present and correct? |
| Related links | Are cross-references to related docs included? |

**When to adjust**: Add opening callout if missing. Fix broken paper links.

**When NOT to adjust**: Don't fabricate links you're not sure about. If the paper doesn't have a GitHub repo, don't add one.

## 3. Text Formatting

### Color System (MANDATORY)

| Syntax | Feishu rendering | When to use |
|--------|-----------------|-------------|
| `{red:text}` | 🔴 Red font color | Key conclusions, important values, must-not-miss facts — **use liberally throughout the document** (10–20× for a long technical paper) |
| `{red:**text**}` | 🔴 Red bold font | Most critical items — conclusions, peak results, key constraints |
| `{green:text}` | 🟢 Green background highlight | Key technical term or system name on **first mention** in body text |
| `{green:**text**}` | 🟢 Green highlight + bold | Core technical concept first mention, extra emphasis |
| `{yellow:text}` | 🟡 Yellow background highlight | Secondary emphasis, caveats, conditions |
| `{orange:text}` | 🟠 Orange background highlight | Additional emphasis |
| `{blue:text}` | 🔵 Blue background highlight | Additional emphasis |
| `{purple:text}` | 🟣 Purple background highlight | Additional emphasis |

### Emphasis Rules (MANDATORY — every upload must include these)

1. **Red text** — You MUST use `{red:...}` and `{red:**...**}` **liberally throughout the document**. A long technical paper needs 10–20 red text instances spread across sections — not just 1–2. Goal: a skimming reader immediately sees red markers at every key point.

   **Granularity: cover full sentences, not just words or numbers.** Mark the entire key sentence or clause — the one a reader must not miss. Do not isolate just a number or a single noun:
   - ❌ `将内存从 {red:199.5 GB} 降至 80 GB` — the number alone is useless without context
   - ✅ `{red:将 DeepSeek-V3 的单 GPU 内存需求从 199.5 GB 降至 80 GB 以下}` — the full conclusion is highlighted
   - ❌ `GB200/GB300 相比 H100 实现约 {red:3×} token 吞吐提升` — the multiplier alone is not actionable
   - ✅ `{red:GB200/GB300 相比 H100 实现约 3× token 吞吐提升}` — the full finding is self-contained

2. **Green highlight** — You MUST add `{green:...}` to each key technical concept, system name, or method name on **first mention** in body text (not in headings). Aim for 5–10 per document.

3. **Bold** — Use `**term**` for all first-mention important terms, list lead-ins, and inline sub-section headings.

4. **Structural signpost phrases** — Bold phrases that function as paragraph-level topic labels. These help readers scan sections without reading every word:
   - **"在...方面" phrases are mandatory**: Always bold "在内存优化方面" → "**在内存优化方面**", "在通信方面" → "**在通信方面**", "在计算效率方面" → "**在计算效率方面**", etc.
   - Other patterns: "**从...角度**", "**关于...**", "**具体来说**", "**值得注意的是**", "**核心区别在于**", "**本质上**"
   - Enumeration lead-ins: when a paragraph lists 3+ items inline, bold each item's name/label
   - Transitional lead-ins: "**首先**", "**其次**", "**最后**", "**一方面...另一方面**" when used as paragraph openers
   - These are NOT red (not conclusions) and NOT green (not technical terms) — just plain bold for structure

5. **Green-highlight enumerated technique names** — When a paragraph enumerates multiple technical techniques with Chinese glosses (e.g., "通过 selective recomputation（选择性重计算）、fine-grained activation offloading（细粒度激活卸载）和 precision-aware optimizer"), apply `{green:...}` to each technique name on first mention:
   - ✅ `通过 {green:selective recomputation}（选择性重计算）、{green:fine-grained activation offloading}（细粒度激活卸载）和 {green:precision-aware optimizer}`
   - This applies to any "A（中文A）、B（中文B）和 C" enumeration pattern where each item is a distinct technique

6. **LaTeX compatibility** — **NEVER place a LaTeX math expression (`$...$` or `$$...$$`) inside a color marker.** The inline equation parser and the color parser conflict, causing the formula to lose color or render incorrectly. If the phrase you want to highlight contains a formula, split the color around it:
   - ❌ `{red:打破传统 $\text{EP}\leq\text{DP}$ 约束}`
   - ✅ `{red:打破传统} $\text{EP}\leq\text{DP}$ {red:约束}`
   - For simple math that can be written without LaTeX (e.g., `18×`), use the Unicode symbol directly inside the color marker: `{red:18× 差距}`

### Other formatting

| Convention | Reference pattern | Apply to source? |
|-----------|-------------------|-----------------|
| **Bold** for key terms | First mention of important concepts bolded | Yes, systematically |
| `inline code` | Used for function names, variables, paths | Match reference usage |
| Callout blocks (`\|>`) | Quote containers for key insights | Add where appropriate |
| `*italic*` | Terms being defined, foreign phrases | Match reference usage |

**When NOT to adjust**: Don't add bold/italic that changes emphasis the author didn't intend. Never bold entire paragraphs — but DO bold structural signpost phrases and enumeration lead-ins for scannability. Preserve all existing emphasis exactly.

## 4. List Conventions

| Check | What to look for |
|-------|-----------------|
| Bullet vs ordered | Reference uses ordered for sequential steps |
| List item format | Short phrases with bold lead-in terms |

**When to adjust**: Convert sequential steps from bullets to ordered lists.

**When NOT to adjust**: If the source's list style is internally consistent and appropriate.

### Sequential Step Patterns ("第x步" / "Step N")

When source uses bold-paragraph headers for sequential steps (e.g., `**第一步：...**` followed by prose), choose format based on content length:

- **Short items** (≤1 sentence per step) → convert to numbered list: `1. **第一步**：...`
- **Long prose or equations per step** → keep as bold-paragraph headers; nesting multi-paragraph content under list items is awkward in Feishu
- **Never use bullet lists** for sequential steps — order matters

### Dense Enumeration Paragraphs

When a paragraph enumerates 3+ items with descriptions (separated by 、；, or similar), convert to a bullet list for readability:

**Convert when:**
- Paragraph lists 3+ named items each with a description/explanation
- Items are separated by Chinese punctuation (、；。) or semicolons
- Each item has enough substance (a phrase or clause, not just a word)

**Keep as paragraph when:**
- Items are bare terms without descriptions (e.g., "支持 CUDA、ROCm、Metal 三种后端")
- The enumeration is part of a flowing argument/narrative
- Total list would be only 2 items

**Format:**
```markdown
- **ItemName**: description of what it does
- **ItemName**: description of what it does
```

Lead-in sentence stays as a paragraph above the list. Each item gets a bold label and colon separator.

## 5. Tables

**Feishu API table limits (empirically confirmed):**

| Limit | Value | Handled automatically? |
|-------|-------|------------------------|
| Max columns (create) | **9** | No — must split |
| Max data rows (create) | **8** | Yes — tool auto-inserts extra rows via `InsertTableRowRequest` |

The `create_children` API enforces these limits (`1770001: invalid param` if exceeded). For rows, `feishu_tool.py` transparently handles tables with more than 8 data rows by inserting extra rows one-by-one after creation. For columns, splitting is still required.

Note: tables created via the Feishu web UI may exceed these limits — the API `create_children` endpoint enforces stricter limits than the UI.

**When to split**: Only split tables when they exceed **9 columns**, or when it makes logical sense to group rows under different sub-labels (e.g., splitting a mixed table by model family). Do **not** split tables just because they have many rows.

**When NOT to split**: Don't split a table just because it has many rows — the tool handles this automatically.

## 6. Code Blocks

| Check | What to look for |
|-------|-----------------|
| Language tags | Reference always uses language tags |
| Annotations | Reference adds comments explaining key lines |

**When to adjust**: Add missing language tags. Never leave bare ` ``` `.

**When NOT to adjust**: Don't modify actual code content.

## 7. Content Density

**When to adjust**: Complete obviously unfinished sentences. Add a brief intro to sections that jump straight into details.

**When NOT to adjust**: Don't pad short sections. Brevity may be intentional.

## 8. Structural Elements

| Element | Reference pattern |
|---------|------------------|
| Blockquotes (`>`) | 📌/📚/TL;DR callouts — use freely for key points, section summaries, insights |
| LaTeX equations | Display math with `$$`, inline with `$` |

---

## Analysis Output Template

After comparing, produce a table like this (for your own reference, not for the user):

```
FORMAT GAPS IDENTIFIED:
1. [opening] Source missing 📌 opening callout with paper/repo links
2. [numbering] Source has duplicate ## 5 sections
3. [code] Source has code blocks without language tags
4. [callouts] Source missing 📌 callout blocks for key concepts

CONTENT ISSUES FOUND:
1. [factual] Section X cites wrong complexity
2. [incomplete] Section Y trails off mid-sentence
3. [numbering] Two sections both labeled "## 5"

CHANGES I WILL NOT MAKE:
1. Source's engaging tone (灵魂拷问, 降维打击, etc.) — author's voice
2. Technical examples and code — correct as-is
3. Section order — narrative flow is logical
4. Author's analogies and explanations — preserve original insights
```
