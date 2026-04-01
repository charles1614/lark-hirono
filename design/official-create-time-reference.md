# Feishu create-time reference — heading colors, light backgrounds, rainbow

All examples below are **create-time valid** (no post-patch).
Validated by experiment 2026-03-29.
Official reference: larksuite/cli → skills/lark-doc/references/lark-doc-create.md

---

## 1. Heading text colors

```md
## Title {color="red"}
## Title {color="blue"}
## Title {color="green"}
## Title {color="orange"}
## Title {color="yellow"}
## Title {color="purple"}
## Title {color="gray"}
## Title {color="blue" align="center"}
```

---

## 2. Numbering prefix — blue prefix, black body

```md
## <text color="blue">1. </text>Title
## <text color="blue">1.1 </text>Title
### <text color="blue">1.1.1 </text>Title
```

Preprocess script: `preprocess/heading_numbering.py`
- multi-level: `1.1 ` (no trailing dot)
- single-level: `1. ` (trailing dot)
- prefix-only colored; body stays default

---

## 3. Heading background — text-level background via `<text bgcolor="...">`

```md
## <text bgcolor="yellow">Heading yellow bg</text>
## <text bgcolor="green">Heading green bg</text>
## <text bgcolor="blue">Heading blue bg</text>
## <text bgcolor="orange">Heading orange bg</text>
```

**Note**: This is text-level background on the heading text run, not block-level background.
Confirmed by fetch-back: `bgcolor` attribute is preserved.

---

## 3b. Heading background — LIGHT variants (officially supported on `<text>`)

```md
## <text bgcolor="light-yellow">Heading light-yellow bg</text>
## <text bgcolor="light-blue">Heading light-blue bg</text>
## <text bgcolor="light-green">Heading light-green bg</text>
```

Verified by fetch-back 2026-03-29: `bgcolor="light-yellow"` / `light-blue` / `light-green` are preserved on `<text>` elements.

---

## 4. Mixed — blue numbering + heading background

```md
## <text color="blue">1.1 </text><text bgcolor="yellow">Yellow bg Title</text>
## <text color="blue">1.2 </text><text bgcolor="green">Green bg Title</text>
```

## 4b. Mixed — rainbow prefix + light background

```md
## <text color="red">1. </text><text bgcolor="light-yellow">Level 2 light-yellow bg</text>
### <text color="orange">1.1 </text><text bgcolor="light-blue">Level 3 light-blue bg</text>
#### <text color="green">1.1.1 </text><text bgcolor="light-green">Level 4 light-green bg</text>
##### <text color="purple">1.1.1.1 </text>Level 5 purple prefix
```

---

## 5. Mixed — blue numbering + colored body text

```md
## <text color="blue">1.1 </text><text color="red">Red Title</text>
## <text color="blue">1.1 </text><text color="purple">Purple Title</text>
```

---

## 6. Inline text colors and backgrounds

```md
<text color="red">red text</text>
<text color="blue">blue text</text>
<text color="green">green text</text>
<text color="purple">purple text</text>
<text bgcolor="yellow">yellow bg</text>
<text bgcolor="green">green bg</text>
<text bgcolor="blue">blue bg</text>
<text bgcolor="orange">orange bg</text>
```

---

## 7. Callout — light backgrounds

```md
<callout emoji="💡" background-color="light-blue" border-color="blue">
  content
</callout>

<callout emoji="⚠️" background-color="light-yellow" border-color="yellow">
  content
</callout>

<callout emoji="✅" background-color="light-green" border-color="green">
  content
</callout>
```

Supported light colors (from official reference):
- light-red / red
- light-blue / blue
- light-green / green
- light-yellow / yellow
- light-orange / orange
- light-purple / purple
- pale-gray / light-gray / dark-gray

---

## 8. NOT available (not confirmed)

- Block-level heading background color (separate from text-level)
- `{background-color="..."}` attribute on headings
- `<text tag="...">` (not in official reference)
- Heading auto-numbering

---

## 9. Current preprocess script behavior

Input:
```md
# 1. Comprehensive Feishu Hybrid Regression
## 1.1 Background
### 1.1.1 Problem Statement
```

Output:
```md
# <text color="blue">1. </text>Comprehensive Feishu Hybrid Regression
## <text color="blue">1.1 </text>Background
### <text color="blue">1.1.1 </text>Problem Statement
```
