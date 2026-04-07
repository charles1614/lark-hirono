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
Input:
## **一、端口规划**
- 80/tcp → Nginx

Output:
## 1. **端口规划** (with blue number)
- 80/tcp → Nginx
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
- ✅ Blue color applied: `<text color="blue">1 </text>`
- ✅ Background colors by depth: red → orange → yellow → green → blue

### Callout

- ✅ First paragraph extracted to callout
- ✅ No duplicate paragraph in body
- ✅ Callout format: `> [!callout icon=bulb bg=2 border=2]`

### Tables

- ✅ Headers bolded: `**Column**`
- ✅ Markdown tables → lark-table XML
- ✅ Escaped pipes handled: `\|` → `|` in cells

### Keywords (catalog_table only)

- ✅ Keywords wrapped: `{red:**keyword**}`
- ✅ Applied to title column only
- ✅ Preserves existing formatting

## Common Issues

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
