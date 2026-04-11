# Document Optimization Guide

Quality standards and reference patterns for document transformation.

## Document Types

### Narrative Documents

Text-heavy documents with headings, paragraphs, and minimal tables.

**Transformations:**
- Normalize markdown (HTML tags → markdown, paragraph breaks)
- Convert Chinese ordinals to sequential numbers
- Inject opening callout with document description
- Apply heading backgrounds (blue numbers)

**Example:**
```markdown
Input (LLM writes):
## 1 端口规划

Pipeline output (period added automatically for single-level):
## <text color="blue">1. </text>端口规划
```

### Catalog Table Documents

Tables with Code/Title columns, 50+ rows.

**Transformations:**
- Normalize markdown
- Convert tables to lark-table XML
- Apply keyword highlighting (requires LLM)

**Example:**
```markdown
Input:
| **Code** | **Title** |
| --- | --- |
| A001 | Important feature |

Output (after LLM keyword selection):
| **Code** | **Title** |
| --- | --- |
| A001 | {red:**Important**} feature |
```

## Quality Standards

### Heading Numbers

- ✅ Sequential numbering: 1, 2, 3...
- ✅ No Chinese ordinals remaining
- ✅ Number prefix color: always `blue` regardless of heading depth — `<text color="blue">1. </text>`
- ✅ Single-level numbers get a period added by the pipeline: input `## 1 Title` → output `<text color="blue">1. </text>Title`
- ✅ Multi-level numbers do NOT get a period: input `### 1.1 Sub` → output `<text color="blue">1.1 </text>Sub`
- ✅ Background colors by heading depth (from `preprocess.ts` defaults):
  - H2 (`##`) → `light-orange`
  - H3 (`###`) → `light-yellow`
  - H4 (`####`) → `light-green`
  - H5 (`#####`) → `light-blue`
  - H6 (`######`) → `light-yellow` (cycles back)

### Callout

- ✅ Opening callout present (narrative docs only — not injected for catalog_table or data_table)
- ✅ First paragraph extracted to callout body (pipeline auto-injects from first paragraph if LLM didn't add one)
- ✅ No duplicate paragraph in body
- ✅ Callout format: `<callout emoji="bulb" background-color="light-blue" border-color="light-blue">`
- ✅ No nested callouts — `<callout>` XML cannot contain another `<callout>` block

### Tables

- ✅ Headers bolded: `**Column**`
- ✅ Markdown tables → lark-table XML
- ✅ Escaped pipes handled: `\|` → `|` in cells

### Keywords (catalog_table only)

- ✅ Keywords wrapped: `{red:**keyword**}`
- ✅ Applied to title column only
- ✅ Preserves existing formatting

## Common Issues

### Nested Callout Blocks

**Problem:** The source document contains a `<callout>` XML block whose body contains another `<callout>` opening tag — i.e., the inner block was not properly closed before the outer one started, or the source document accidentally stacked two callout regions.

Note: `> 📌 **Key**: ...` markdown blockquotes inside a `<callout>` are NOT the same as nested callouts — blockquotes render fine inside a callout body. Only literal `<callout>` XML tags nested inside another `<callout>` XML block are a problem.

**Solution:** Lark does not render nested `<callout>` XML blocks. Convert the inner `<callout>` block to plain paragraphs: remove the `<callout>`, `</callout>`, and its attribute tags; keep the text content as regular paragraphs. Only one `<callout>` nesting level is allowed at any point in the document.

### `<text color>` Tag — Always Use Shorthand Form

**Valid forms for writing optimized content:**
- Shorthand: `{green:Certbot}` ✅
- Shorthand with code: `` {green:`Certbot`} `` ✅
- Shorthand with bold (bold INSIDE): `{green:**Certbot**}` ✅

**Raw `<text color>` HTML from fetched docs does NOT render** — it appears as literal plain text in the uploaded document. During optimization, convert every `<text color="COLOR">CONTENT</text>` tag to its `{COLOR:CONTENT}` shorthand form. Never preserve raw `<text color>` HTML in the optimized output.

---

## Rendering Pitfalls

These patterns cause broken rendering. Always use the correct form.

### Bold + Color Tag

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `**{red:conclusion}**` | `{red:**conclusion**}` |
| `**{green:term}**` | `{green:**term**}` |

**Why**: `**{color:text}**` converts to `**<text color>text</text>**` — lark-cli can't bold-wrap an XML span and fragments it into multiple `<text>` elements. Bold must go INSIDE the color tag.

The pipeline (3-pass color conversion) handles this automatically, but prevention is more reliable.

### Formulas in Headings

❌ `## 3.1 Throughput $\text{SM}_{peak}$ Analysis`  
✅ `## 3.1 Throughput SM-peak Analysis`

**Why**: lark-cli does not render `<equation>` inside headings. The pipeline strips equations from headings and unwraps to raw LaTeX text, but plain text is better — write prose descriptions instead of formulas in titles.

### Bold Wrapping Equation

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `**text $formula$ more**` | `**text** $formula$ **more**` |
| `**输入梯度 **$\nabla X$` | `**输入梯度** $\nabla X$` |

**Why**: `**text **<equation>` — the second `**` before `<equation>` closes the bold span early, leaving the equation unbolded. Keep `**` markers away from `$formula$` boundaries.

### LaTeX Subscripts Outside Equation Delimiters

❌ `\text{SM Throughput}_{\%} = \frac{...}{\text{Peak}_{\text{Hardware}}} \times 100\%` (bare LaTeX)  
✅ `$\text{SM Throughput}_p = \frac{...}{\text{Peak}_h} \times 100\%$`  
✅ `<equation>\text{SM Throughput}_p = \frac{...}{\text{Peak}_h} \times 100\%</equation>`

**Why**: `_` in bare LaTeX text (outside `$...$` or `<equation>`) is treated as markdown italic. `_{\%}` starts italic; the next `_` closes it, splitting the formula into `*{\%} = ...*` (italic) + misplaced `<equation>`. Always wrap complete formulas.

**Multi-subscript equations**: lark-cli 1.0.6 processes markdown `_` italic INSIDE `<equation>` content. Formulas with two or more `_{...}` subscripts (where `{` follows `_`) will break because the first `_` and second `_` pair as italic delimiters.

**Workaround**: Use single-character alphabetic subscripts WITHOUT braces: `_p`, `_h`, `_e`, `_w` etc. When `_` is followed by an alphabetic character (not `{`), it cannot act as a right-flanking delimiter and cannot close italic. One subscript per formula can use `_{\text{...}}` safely (no pairing partner).

| ❌ Two subscripts with `{` | ✅ Single-char subscripts |
|--------------------------|--------------------------|
| `\text{SM}_{pct} = \frac{...}{\text{Peak}_{hw}}` | `\text{SM}_p = \frac{...}{\text{Peak}_h}` |
| `\text{Util}_{\text{elapsed}}..._{\text{Wall}}` | `\text{Util}_e..._w` |

**Preserve existing `<equation>` tags**: If source has `<equation>...</equation>`, copy verbatim — do NOT rewrite as `$...$`. Rewriting risks splitting the formula.

### `>` at Start of Table Cell

❌ `| Description | > This is a note |`  
✅ `| Description | This is a note |`  
✅ `| Description | → This is a note |`

**Why**: A line starting with `>` inside a table cell may be interpreted as a markdown blockquote by lark-cli. The pipeline escapes leading `>` automatically, but using `→` or prose is cleaner.

### Nested Color Tags

✅ Supported: `{green:text {red:number}}` — the pipeline uses a 3-pass conversion that resolves inner tags first.

❌ Avoid deep nesting (3+ levels) — unnecessary and unreliable.

### Chinese Ordinals Not Converted

**Problem:** `## **一、端口规划**` remains unchanged

**Solution:** Regex now handles bold markers. Check if:
- Heading is H1 or H2 (only these are numbered)
- Chinese ordinal is valid: 一二三四五六七八九十 or 甲乙丙丁戊己庚辛壬癸

### Callout Not Injected

**Problem:** Document has no callout

**Solution:** Callout requires:
- First paragraph must be plain text (not heading/list)
- Document type is "narrative" (not data_table/catalog_table)

### Keyword Highlights Missing

**Problem:** No `{red:**keyword**}` tags in output

**Solution:** For catalog_table docs:
1. Run `highlight extract input.md`
2. Send JSON to LLM
3. Save response as `.selected_keywords.json`
4. Re-run upload/optimize

### Table Headers Not Bolded

**Problem:** Table headers appear without bold

**Solution:** The `boldTableHeaders()` function runs automatically. Check if:
- Table has separator row (`|---|---|`)
- Header row is directly above separator

## Verified Syntax Reference

Quick-reference tables of patterns verified against the Feishu upload pipeline. When writing optimized content, match these exactly — they are ground truth, not suggestions.

### Color & Emphasis Tags

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| `<text color="green">BF16</text>` | `{green:BF16}` | Raw HTML does not render — appears as plain text |
| `<text color="green">**BF16**</text>` | `{green:**BF16**}` | Raw HTML + bold — still plain text; convert to shorthand with bold inside |
| `<text color="red">**conclusion**</text>` | `{red:**conclusion**}` | Same rule for red |
| `**{red:conclusion}**` | `{red:**conclusion**}` | Bold OUTSIDE fragments spans; bold must go inside |
| `**{green:term}**` | `{green:**term**}` | Same rule for green |
| `` **{red:`cmd`}** `` | `` {red:`cmd`} `` | No outer bold for inline code — code is already distinct |
| `` {green:`code`} `` | `` {green:`code`} `` | ✅ Inline code inside color shorthand |
| `{green:text {green:more}}` | `{green:text {red:more}}` | Same-color nesting is unnecessary |
| `{a:{b:{c:text}}}` (3+ levels) | `{green:outer {red:inner}}` | Max 2 levels; 3+ unreliable |

### Heading Numbering

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| `## 1. 标题` | `## 1 标题` | Don't write the period — pipeline adds it for H2 |
| `### 1.1. 子标题` | `### 1.1 子标题` | Don't write period for multi-level |
| `## 一、标题` | `## 1 标题` | Chinese ordinal — no blue coloring |
| `## **一、标题**` | `## 1 标题` | Chinese ordinal wrapped in bold — still broken |
| `## 甲、标题` | `## 1 标题` | Heavenly stem ordinal — same fix |
| `## $\text{SM}_{peak}$ Analysis` | `## SM-peak Analysis` | Equations in headings are stripped, use prose |
| Lone unnumbered `## Cheatsheet` among `## 1 …`, `## 2 …` | `## 3 Cheatsheet` | All siblings must be consistently numbered |

### Callout XML (Opening Block)

```markdown
✅ Correct form:
<callout emoji="bulb" background-color="light-blue" border-color="light-blue">

本文档解析… (plain text summary, NO emoji prefix here)

</callout>
```

```markdown
❌ Wrong — emoji duplicated in body:
<callout emoji="bulb" background-color="light-blue" border-color="light-blue">

📌 本文档解析…   ← remove the 📌 prefix

</callout>
```

```markdown
❌ Wrong — nested callout XML:
<callout emoji="bulb" …>
  Some text
  <callout emoji="star" …>   ← Lark won't render this
    Inner content
  </callout>
</callout>

✅ Fix — flatten the inner callout to plain paragraphs:
<callout emoji="bulb" …>
  Some text
  Inner content
</callout>
```

**Valid icon names** (use the name, not emoji character): `bulb`, `bookmark`, `pushpin`, `rocket`, `star`, `gift`, `warning`, `info`, `check`, `fire`

### Inline Blockquote Callouts

These use `>` blockquote syntax — **not** `<callout>` XML. The pipeline converts them automatically.

| Pattern | Auto-converted to | Notes |
|---------|------------------|-------|
| `> 📌 **Key insight**: text` | `<callout>` (yellow) | General key point |
| `> 📚 **背景**: text` | `<callout>` (blue) | Background context |
| `> TL;DR: text` | `<callout>` (blue) | Summary |
| `> 核心思想: text` | `<callout>` (green) | Core idea |
| `> 关键结论: text` | `<callout>` (green) | Key conclusion |
| `> 一句话总结: text` | `<callout>` (blue) | One-line summary |
| `> 核心区别: text` | `<callout>` (yellow) | Key difference |

**Never manually write `<callout>` XML for these patterns** — write the `> ...` form and let the pipeline convert. Writing XML directly risks nesting.

### Equations & LaTeX

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| Bare LaTeX: `\text{SM}_p = \frac{a}{b}` | `$\text{SM}_p = \frac{a}{b}$` | Bare `_` outside delimiters becomes italic |
| Two `_{...}` subscripts: `$\text{SM}_{pct} / \text{Peak}_{hw}$` | `$\text{SM}_p / \text{Peak}_h$` | lark-cli pairs `_{…}` as italic delimiters |
| Three subscripts: `$A_{x} + B_{y} + C_{z}$` | `$A_x + B_y + C_z$` | Single-char subscripts are safe (no `{`) |
| Rewrite `<equation>…</equation>` as `$…$` | Copy `<equation>…</equation>` verbatim | Rewriting risks splitting the formula |
| `**text $formula$ more**` | `**text** $formula$ **more**` | `**` next to `$` boundary closes bold early |
| `## 3.1 $\text{SM}_{peak}$ Title` | `## 3.1 SM-peak Title` | Equations stripped from headings |
| One `_{...}` per formula (safe) | `$\text{SM}_{\text{active}}$` ✅ | Single subscript with braces is fine |

### lark-table Cell Content

Inside `<lark-td>` blocks, text is literal — markdown heading/escape rules do not apply.

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| `\# of cycles where tensor is active` | `# of cycles where tensor is active` | `#` is plain text inside a cell |
| `\# of warp instructions executed` | `# of warp instructions executed` | Same — never escape `#` in `<lark-td>` |
| `*sm__throughput.avg.pct*` (bold dropped) | `***sm__throughput.avg.pct***` | Preserve triple-asterisk bold-italic from source |
| Drop `***metric***` and write metric plain | `` `metric` `` or `***metric***` | Explicit conversion OK; silent drop is not |
| `<quote-container>text</quote-container>` inside `<lark-td>` | Keep text content; strip XML tags | `<quote-container>` is a Feishu fetch artifact — render as plain text or `{color="LightRedBackground"}` line |

### Images & Embedded Content

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| Drop `<image token="…">` | `<image token="H7mc…" width="1183" height="638" align="center"/>` verbatim | Token points to Feishu-hosted image; dropping = content loss |
| Replace with `![alt](url)` | Copy tag verbatim | No external URL available |
| Modify `width`/`height` | Copy unchanged | Pipeline doesn't reprocess dimensions |
| Drop `<whiteboard token="…"/>` | Copy verbatim | Same rule as images |

### Code Blocks

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| ` ``` ` (no language tag) | ` ```python ` / ` ```bash ` | Pipeline auto-tags common languages, but explicit is preferred |
| ` ```CUDA ` | ` ```cpp ` | Use standard lowercase identifiers |
| ` ```shell ` | ` ```bash ` | Prefer `bash` over `shell` |

Pipeline auto-recognizes: `python`, `bash`, `nginx`, `yaml`, `json`, `go`, `typescript`, `javascript`, `sql`, `c`, `cpp`.

### Markdown Tables (non-lark-table)

| ❌ Wrong | ✅ Correct | Notes |
|----------|-----------|-------|
| `\| Column \|` (unbolded header) | `\| **Column** \|` | Headers must be bolded |
| `\| Description \| > Note \|` | `\| Description \| → Note \|` | Leading `>` in cell = blockquote interpretation |
| `\|lark-table rows="N"…\|` (pipe-wrapped) | `<lark-table rows="N"…>` XML | Pipe-wrapped form is invalid syntax |

---

## Verification

Run verify after optimization:

```bash
npx tsx bin/lark-hirono.ts verify --doc <id>
```

Expected output for narrative:
- ✅ Headings numbered sequentially
- ✅ Callout present
- ✅ No Chinese ordinals
- ✅ Heading backgrounds applied

Expected output for catalog_table:
- ✅ Tables present
- ✅ Bold headers
- ✅ Keyword highlights (if `.selected_keywords.json` provided)
