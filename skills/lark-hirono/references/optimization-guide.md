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
