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

### `<text color>` Tag With Inline Code

**Supported forms (all valid for upload):**
- Shorthand: `{green:Certbot}` → `<text color="green">Certbot</text>` ✅
- Shorthand with code: `` {green:`Certbot`} `` → `<text color="green">`Certbot`</text>` ✅
- Raw HTML from fetch: `<text color="green">Certbot</text>` passes through unchanged ✅

**No special handling needed** — do not strip color tags or downgrade them to plain text. All three forms survive the upload pipeline.

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
