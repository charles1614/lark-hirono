---
name: feishu
description: >-
  Feishu (Lark) wiki tools: read pages as markdown, write markdown to new pages,
  optimize document formatting, upload local markdown files, copy/sync/export wiki pages.
  Use this skill when the user wants to interact with Feishu wiki — read, write, copy,
  sync, export, optimize/polish wiki pages, or upload a local .md file to Feishu.
  Triggers on: feishu, lark, 飞书, wiki page, read feishu, write feishu, optimize feishu,
  copy feishu, sync feishu, export feishu, upload feishu, upload md to feishu, upload markdown.
---

# Feishu Wiki Tools

Read, write, optimize, upload local markdown, copy, sync, and export Feishu wiki pages.

## Skill Files Location

This skill's supporting files are located relative to this SKILL.md:

- `scripts/feishu_tool.py` — Self-contained Python script for read/write/info operations (needs only `.env`)
- `references/optimization-guide.md` — Format comparison framework and known reference patterns
- `references/conservative-edits.md` — Guidelines for light-touch editing

## Prerequisites

- `.env` file with credentials (checked in order):
  1. `.env` in the current directory
  2. `~/.config/feishu_tools/.env`
  ```
  FEISHU_APP_ID=your_app_id
  FEISHU_APP_SECRET=your_app_secret
  ```
- Python packages: `requests`, `python-dotenv`

## Data Locations

- **Token cache**: `~/.config/feishu_tools/token_cache.json`
- **Sync state**: `~/log/feishu_tools/sync_logs/state/`
- **Sync logs**: `~/log/feishu_tools/sync_logs/` (one log per sync run)

Install dependencies on first run:
```bash
pip install requests python-dotenv 2>/dev/null
```

## Arguments

$ARGUMENTS should be: `ACTION [ARGS...]`

Determine the action from the user's intent:

| User intent | Action |
|-------------|--------|
| Read/view/fetch a page | `read SOURCE_URL` |
| Write/create/publish a page | `write PARENT_URL` |
| Compare two pages | `diff LEFT_URL RIGHT_URL` |
| Show page metadata | `info SOURCE_URL` |
| Optimize/polish a page | `optimize SOURCE_URL DEST_URL` |
| Upload a local markdown file | `upload MD_PATH PARENT_URL` |
| Copy a page | `copy SOURCE_URL TARGET_URL` |
| Sync pages | `sync SOURCE_URL TARGET_URL` |
| Export to local files | `export SOURCE_URL` |

**`upload` command**: `/feishu upload [md_path] [parent_url]`
- `md_path` may be relative (resolved from current working directory) or absolute
- `parent_url` is the Feishu wiki URL under which the new page will be created as a sub-page

---

## Action: read

Read a Feishu wiki page and display its content as markdown.

```bash
python <skill-directory>/scripts/feishu_tool.py read SOURCE_URL
```

Options:
- `--no-title` — Omit the H1 title from output

The script outputs clean markdown to stdout (logs go to stderr). Display the content to the user. If they ask follow-up questions, answer based on the retrieved text.

### Notes
- On first run, it may prompt for OAuth authorization — follow the printed URL
- Token is cached in `~/.config/feishu_tools/token_cache.json` for subsequent runs
- Supports docx-type wiki pages only

---

## Action: diff

Read two Feishu wiki pages as markdown and print a unified diff.

```bash
python <skill-directory>/scripts/feishu_tool.py diff LEFT_URL RIGHT_URL
```

Options:
- `--no-title` — omit the H1 title before diffing
- `--context N` — control unified diff context size (default: 3)
- `--normalize` — normalize markdown before diffing to reduce noisy differences

Recommended use:
- Compare a newly created page against a reference page before modifying the tool or skill
- Use `--normalize` when you want to focus on substantive markdown structure differences rather than trivial separator normalization (e.g. Unicode dashes in table separator rows)

---

## Action: info

Show page metadata.

```bash
python <skill-directory>/scripts/feishu_tool.py info SOURCE_URL
```

Prints: title, node token, obj token, obj type, space ID, has_child.

---

## Action: write

Create a new Feishu wiki page from markdown content.

1. Prepare the markdown content from the conversation or a file.
2. Write the optimized content to a temp file, then upload:
   ```bash
   # Step 1: Write content to a temp file
   UPLOAD_TMP=$(mktemp /tmp/feishu_upload_XXXXXX.md)
   cat > "$UPLOAD_TMP" << 'FEISHU_CONTENT_END'
   ## Section 1

   Content here...
   FEISHU_CONTENT_END

   # Step 2: Upload from file
   python <skill-directory>/scripts/feishu_tool.py write PARENT_URL \
     --title "Page Title" \
     --input-file "$UPLOAD_TMP"

   # Step 3: Clean up
   rm -f "$UPLOAD_TMP"
   ```
3. The script prints the new page URL to stdout. **Share this URL** with the user.

### Options
- `--heading-color` — Auto-color heading backgrounds by relative depth: outermost → **red/pink**, then orange, yellow, green, blue, purple. Explicit `{bg=N}` on a heading always wins.
- `--input-file FILE` / `-f FILE` — Read markdown from `FILE` instead of stdin. Preferred over heredoc for large documents (avoids shell escaping issues).

### Inline formatting
| Syntax | Result |
|--------|--------|
| `**text**` | Bold |
| `*text*` | Italic |
| `` `code` `` | Inline code |
| `~~text~~` | Strikethrough |
| `[label](url)` | Link |
| `{red:text}` | 🔴 **Red text color** — use liberally for key points (10–20× per document) |
| `{red:**text**}` | 🔴 **Red bold text** — highest emphasis for critical conclusions |
| `{green:text}` | 🟢 Green background highlight |
| `{green:**text**}` | 🟢 Green highlight + bold — key concept first mention |
| `{yellow:text}` | 🟡 Yellow background highlight |
| `{orange:text}` | 🟠 Orange background highlight |
| `{blue:text}` | 🔵 Blue background highlight |
| `{purple:text}` | 🟣 Purple background highlight |

### Notes
- New page is created as a child (sub-node) of the parent.
- If `--title` is omitted, title is extracted from the first H1.
- Always use `<< 'FEISHU_CONTENT_END'` (quoted delimiter) to prevent variable expansion in the temp file write step.
- The `--input-file` approach avoids heredoc shell escaping issues (e.g. `{red:...}` markers containing `{...}` in LaTeX).
- Supported: headings, paragraphs, bold, italic, code, strikethrough, links, bullet/ordered lists, code blocks, blockquotes, dividers, **tables** (`| col | col |` pipe format), callout blocks, quote containers (`|>` prefix), LaTeX equations, **images**.
- **Images**: Use `![alt](path)` in markdown. Pass `--image-dir DIR` to resolve relative image paths. Images are uploaded after block creation. If `--image-dir` is omitted, image lines are treated as text.

---

## Action: upload

Upload a local markdown file to Feishu as a new sub-page, applying the same light-touch optimization rules as the `optimize` action before publishing.

**Format**: `/feishu upload MD_PATH PARENT_URL`

- `MD_PATH` — path to the local `.md` file (relative to CWD or absolute)
- `PARENT_URL` — Feishu wiki URL; the new page is created as its direct child

**Core principle**: The local file is the authority. Apply formatting improvements from the optimization guide, but do NOT rewrite the author's content, tone, or intent.

### Workflow

Follow these 5 tasks in order:

#### Task 1: Read the Local Markdown File

Resolve the path:
- If `MD_PATH` starts with `/`, it is absolute — use as-is
- Otherwise, resolve relative to the current working directory

```bash
# Resolve relative path if needed
realpath MD_PATH
```

Read the file content. This is the document to upload.

**Analyze carefully:**
- Document title (first H1, or filename if no H1)
- Overall topic and purpose
- Author's writing style and tone
- Existing heading structure and hierarchy
- Content organization and flow
- Use of formatting (bold, lists, code blocks, tables, LaTeX, etc.)
- Metadata blocks (author, venue, date, etc.)
- **Technical payload that must survive**: numbers, formulas, systems, complexity, deployment facts, experiment settings, citations, caveats, mechanism details

**Record your observations** — you will need them in Task 4 to preserve the original character.

#### Task 2: Format Analysis

Read [`references/optimization-guide.md`](<skill-directory>/references/optimization-guide.md) for the detailed comparison framework and known format conventions.

**Reference Discipline:**
- The optimization guide is a style reference, not a license to restyle the document wholesale
- Preserve the source document's macro-structure unless there is a clear formatting defect
- Do not renumber or deepen the heading hierarchy just to match the reference pattern if the source already has a stable hierarchy
- If an opening block, metadata block, or summary layout already works, prefer light cleanup over redesign
- Prefer blockquote-style callouts that round-trip correctly in exported markdown

Check the document against these specific format conventions:

| Convention | Expected Pattern | Source Status |
|------------|-----------------|---------------|
| Opening callout | `[!callout]` with description + paper/repo links | Present? Missing? |
| Numbered headings | `## 1 标题` / `### 1.1 子标题` / `#### 1.1.1 三级子标题` | Correct numbering? Duplicates? |
| Heading groups | Continuous numbering across whole doc (no resets) | Multiple `## 1` resets? |
| Level conflicts | Group/chapter titles at correct level vs. sub-items | Any group title at same level as children? |
| Callouts/quotes | `\|>` / `[!callout]` / `> 📌` freely throughout (5–15 per long doc) | Enough callouts? TL;DR blocks styled? |
| Code block tags | Language tag on every code block | Any bare ` ``` `? |
| Bold key terms | First mention of important technical terms bolded | Applied? |
| Inline emphasis | `{red:...}` / `{red:**...**}` for key points (10–20× in a long doc); `{green:...}` for first-mention key terms (5–10×) | Enough red text? |
| LaTeX equations | `$inline$` and `$$display$$` | Correct syntax? |
| Formula placement | Formulas in normal paragraphs, not inside blockquotes/callouts | Any `$...$` inside `>`? |

**Hard Constraints:**
- Do **not** assume numbered headings are mandatory when the source already has a coherent hierarchy
- **Exception — Chinese ordinal headings are always a defect**: `## 一、`, `## 二、`, `## 三、`… use Chinese characters that do NOT trigger the tool's blue-number coloring. Always convert to `## 1 Title`, `## 2 Title`… format. This is not optional.
- Do **not** force extra subsection levels simply because the reference is more granular
- **All siblings at the same heading level must be consistently numbered or consistently unnumbered.** A lone unnumbered heading (e.g., `## Cheatsheet`) among numbered siblings must be assigned the next sequential number.
- Treat opening layout, metadata layout, and top-of-document summary layout as high-risk areas where over-editing is likely to regress the page
- Prefer blockquote-style callouts that round-trip correctly in exported markdown

**Important**: Only note FORMAT differences. Do not evaluate content topics.

#### Task 3: Content Review (Light Touch)

Read [`references/conservative-edits.md`](<skill-directory>/references/conservative-edits.md) for detailed guidelines.

**Fix These:**
- **Factual errors**: Incorrect technical information, wrong version numbers, broken links
- **Incomplete descriptions**: Sentences that trail off, missing explanations, TODO/placeholder text
- **Obvious typos**: Spelling errors, grammar mistakes that change meaning
- **Broken formatting**: Unclosed markdown, inconsistent list indentation

**Do NOT Change:**
- **Author's tone**: If they write casually, keep it casual
- **Content focus**: Respect what the author chose to emphasize
- **Technical opinions**: If they recommend a tool or approach, keep it
- **Original structure**: Only adjust structure if it clearly conflicts with format conventions
- **Level of detail**: If the author was brief on a topic, respect that

#### Task 4: Generate Optimized Version

**CRITICAL**: The optimized document should be **80%+ identical** to the original. Changes should be subtle improvements, not rewrites.

**What to change:**

1. **Opening callout** — Add a `[!callout]` block at the top if missing
   - Use `[!callout icon=ICON bg=2 border=2]` — choose an appropriate icon (e.g. `gift`, `bulb`, `bookmark`, `pushpin`, `rocket`, `star`)
   - Put the document's intro description AND paper/code links **all inside** the callout as child paragraphs
   - Example:
     ```
     > [!callout icon=gift bg=2 border=2]
     > 本文档...的简介文字。
     >
     > **Paper**: [Title](url)
     >
     > **Code**: [GitHub](url)
     >
     ```
   - If the source already has an intro `|>` quote container or a plain `>` blockquote that functions as the document summary (e.g., `> 一句话总结: ...`), move its text into the callout as a child paragraph and remove the original block

2. **Heading restructuring** — Fix numbering AND hierarchy when needed:
   - Apply **continuous sequential numbering at all heading levels**: `## 1`, `## 2`… for top-level; `### 1.1`, `### 1.2`… for second-level; `#### 1.1.1`, `#### 1.1.2`… for third-level. Never leave any heading level unnumbered if its parent level is numbered.
   - **Number format**: Always use `## 1 Title` (number then space then title — **no period** after the number). The upload tool automatically colors the numeric prefix blue. Format `## 1. Title` (period after number) will NOT trigger auto-blue coloring.
   - **Heading groups**: If multiple sections each restart at "1.", "2."… choose:
     - *Elevate the group header*: if a heading logically contains sub-items also at the same level, promote it one level up
     - *Continuous renumber*: if no clear group header, renumber all items sequentially
   - **Level conflicts**: if a heading that groups sub-sections is at the same level as those sub-sections, promote it one level
   - **Renaming allowed**: you MAY revise a heading's title when it's too generic — keep the core topic, just improve precision
   - **Reordering allowed**: you MAY reorder sections when the logical flow clearly improves (note each reorder in the summary)

3. **Callouts and quote containers — use freely throughout the document**
   - **TL;DR blocks** → always convert to **blue callout**: `[!callout icon=bulb bg=2 border=2]` (NOT a `|>` quote container)
   - **"一句话总结" / "一句话定位" / "核心思想" / "关键结论"** → normally convert to **green callout**: `[!callout icon=pushpin bg=3 border=3]` (NOT a `|>` quote container); **exception**: if they contain `$...$`, `$$...$$`, or multiple inline equations, use normal body text or a nearby summary subsection instead
   - Add `|>` quote containers for other key insights, important observations, counterintuitive findings, and critical design decisions — no upper limit
   - Add `> 📌 **标题**: ...` blockquotes for critical facts and must-not-miss design decisions
   - A well-formatted long document should have **5–15 callouts/quote containers** spread across sections

   **Feishu Callout Syntax Rules:**
   - Use `> [!callout icon=...]` form, not a bare `[!callout ...]` line
   - Keep the callout marker and its body in the same blockquote group
   - If unsure whether a custom callout will round-trip correctly, use a plain `> 📌 ...` blockquote instead

   **Formula Safety Rules:**
   - Do **not** keep formula-bearing summaries inside blockquotes, callouts, or quote containers
   - If a summary sentence contains LaTeX, place it as a normal paragraph or a nearby summary subsection
   - If a sentence mixes prose and several formulas, prefer a normal paragraph
   - If the formula is the main payload, prefer a lead-in sentence plus a standalone display equation block

4. **Code block language tags** — Add missing language tags to bare code blocks

5. **Formatting conventions**
   - Bold key technical terms on first mention
   - Use `inline code` for function names, variables, file paths

6. **Inline emphasis — MANDATORY**

   **You MUST add these — a document with no color markup is incomplete:**
   - `{red:text}` / `{red:**text**}` — **red text color**, use **liberally throughout** the document. Every key conclusion, important value, critical fact, must-not-miss point should be red. A long technical paper needs 10–20 red instances across sections. `{red:**...**}` for the most critical items.
   - `{green:text}` / `{green:**text**}` — **green background highlight** for key technical concepts, system names, method names on **first mention** in body text (5–10 per document)

   **Other emphasis:**
   - `{yellow:text}`, `{orange:text}`, `{blue:text}`, `{purple:text}` — background highlights for secondary emphasis
   - `**bold**` — key technical terms, list lead-ins, first-mention important terms
   - `*italic*` — terms being defined, foreign phrases, titles

   **Structural emphasis for scannability:**
   - **Bold structural signposts**: Bold ALL "在...方面" / "在...上" phrases that introduce a topic shift — e.g., "在内存优化方面" → "**在内存优化方面**", "在通信方面" → "**在通信方面**". Also bold: "**从...角度**", "**具体来说**", "**值得注意的是**", "**核心区别在于**"
   - **Bold enumeration lead-ins**: When a paragraph lists items inline (A does X, B does Y, C does Z), bold each item name: "**A** does X, **B** does Y, **C** does Z"
   - **Green-highlight enumerated technique names**: When a paragraph enumerates multiple technical techniques with Chinese glosses (e.g., "通过 selective recomputation（选择性重计算）、fine-grained activation offloading（细粒度激活卸载）和 precision-aware optimizer"), apply `{green:...}` to each technique name on first mention: `通过 {green:selective recomputation}（选择性重计算）、{green:fine-grained activation offloading}（细粒度激活卸载）和 {green:precision-aware optimizer}`
   - **Red for full conclusions**: Red should mark the complete actionable finding, not just a number. Bad: `{red:199.5 GB}`. Good: `{red:将内存需求从 199.5 GB 降至 80 GB 以下}`. Each section should have 1–2 red sentences.

   Rules:
   - Preserve ALL existing `{red:...}`, `{green:...}`, `**bold**`, `*italic*` exactly
   - Never mark entire paragraphs — but DO mark full key sentences/clauses that a reader must not miss
   - Red emphasis is reserved for conclusions and consequences, not routine explanatory clauses
   - Green emphasis is used on genuine first-mention concepts, not repeated on every prominent noun

7. **Factual corrections** — Fix identified errors from Task 3

8. **Description completion** — Flesh out incomplete sections
   - Add only information that is clearly implied or factually obvious
   - Do NOT fabricate details or add your own opinions

9. **Ordered list numbering** — Feishu does NOT auto-renumber ordered list items. If the source markdown uses `1.` for every item (a common Markdown habit), all items render as "1." in Feishu. Always use explicit sequential numbers: `1.`, `2.`, `3.`, `4.`…

10. **Intelligent list conversion** — Dense paragraphs that enumerate items should be broken into structured lists:
   - **When to convert**: A paragraph listing 3+ items/features/components with descriptions, separated by 、/；/semicolons, or using "A: desc, B: desc, C: desc" structure
   - **Format**: Bullet list with bold lead-ins: `- **ItemName**: description`
   - **When NOT to convert**: Items are very short (1–2 words) with no descriptions — keep as inline list. Also keep as paragraph if the enumeration is embedded in narrative flow.

**What NOT to change:**
- Author's tone and voice (colorful language is intentional)
- Existing emphasis (`{red:...}`, bold)
- Section scope (don't merge or split sections)
- Technical examples and code snippets (preserve exactly)
- Author's analogies and explanations
- Length (don't pad sections)
- Author's personal insights or recommendations

Produce the **complete optimized markdown**. Do NOT output a diff — output the full document.

#### Task 4.5: Content Preservation Audit

Before proceeding to upload, check for:
- Dropped bullets or list items
- Shortened mechanism descriptions
- Removed numbers, formulas, complexity, thresholds
- Removed deployment/experiment/workload facts
- Removed citations or named systems
- Macro-structure drift: added or removed top-level sections, subsection splits, or heading renumbering not justified by a broken source
- Opening-layout drift: title-adjacent summary, author/meta block, and first visual block still feel like the source rather than a template rewrite

If any technical section is materially shorter, re-check it line by line.

#### Task 4.6: Emphasis Audit

Before proceeding to upload, check for:
- At least 1 red conclusion in each major section
- Green first-mention highlights where new concepts appear
- Bold structural anchors
- Yellow highlights for caveats/tradeoffs where appropriate
- Emphasis density still matches the source tone; remove highlights if the page starts to feel over-marked or noisier than the reference
- Red emphasis is reserved for conclusions and consequences, not routine explanatory clauses
- Green emphasis is used on genuine first-mention concepts, not repeated on every prominent noun

#### Task 4.7: Rendered-Layout Regression Check

Visually inspect the final markdown and reject it if any of these regressions appear:
- Opening callout or opening summary looks weaker than the source/reference
- Top metadata collapses into stray lines or duplicated blocks
- A clean source paragraph was turned into a noisier list, or a clean list into a denser paragraph
- Headings became more numerous or deeper without a clear readability win
- Emphasis feels materially louder than the source/reference
- Callout syntax is likely to render literally instead of as a Feishu callout

#### Task 5: Write to Feishu

Determine the page title:
- Use the document's first H1 heading if present
- Otherwise, derive a clean title from the filename (strip path, underscores → spaces, drop `.md`)

Determine the image directory:
- If the markdown file references images with relative paths (e.g., `![](figures/fig1.png)`), set `IMAGE_DIR` to the directory containing the markdown file
- If images use absolute paths or the document has no images, omit `--image-dir`

Create a sibling upload file and write the optimized content to it:

```bash
UPLOAD_MD="${MD_PATH%.md}_upload.md"
cp "MD_PATH" "$UPLOAD_MD"
# Edit $UPLOAD_MD directly so it contains the final upload body.
# Important: remove the H1 title line from the body (title is passed via --title).

python <skill-directory>/scripts/feishu_tool.py write PARENT_URL \
  --heading-color \
  --image-dir "IMAGE_DIR" \
  --title "TITLE" \
  --input-file "$UPLOAD_MD"
```

**Important notes:**
- Always include `--heading-color` to auto-color headings by depth
- Include `--image-dir` pointing to the markdown file's parent directory when images are present
- **Do NOT include the `# Title` H1 line in the content body.** The title is set via `--title`. If H1 is in the body, heading depths shift by 1 and all headings get the wrong color.
- **Keep the generated `*_upload.md` file — do not delete it** so the upload artifact can be reviewed later
- The `--input-file` approach avoids shell escaping issues and enables image upload auto-retry

The script prints the URL of the newly created page. **Share this URL with the user.**

#### Post-upload verification (optional)

```bash
python <skill-directory>/scripts/feishu_tool.py read NEW_PAGE_URL
```

### Summary Report

After completing all tasks, provide the user with:

1. **URL** of the new page
2. **Changes made** — brief list of formatting improvements applied
3. **Confidence level** — how confident you are in the changes

---

## Action: optimize

Light-touch optimization of a Feishu wiki document: fix errors, complete descriptions, and slightly improve formatting — while preserving the original author's tone, style, and intent.

**Core principle**: The original document is the authority. The reference document only guides formatting structure. Never rewrite or restructure aggressively.

**Output**: A new wiki sub-page under the reference document containing the optimized version.

### Arguments

- **SOURCE_URL**: The document to optimize (content source)
- **DEST_URL**: The well-formatted reference document (format guide only; new page created under this)

### Workflow

Follow these tasks in order:

1. **Read Source** — Fetch and understand the source document
2. **Read Reference** — Fetch and analyze the reference document's format
3. **Format Analysis** — Compare structures and identify format gaps
4. **Content Review** — Identify factual errors, incomplete descriptions, minor issues
5. **Generate Optimized Version** — Apply light-touch improvements
5.5. **Content Preservation Audit** — Verify no content was dropped or shortened
5.6. **Emphasis Audit** — Verify color/bold density is appropriate
5.7. **Rendered-Layout Regression Check** — Verify no visual regressions
6. **Write to Feishu** — Create new sub-page with optimized content

### Task 1: Read Source Document

```bash
python <skill-directory>/scripts/feishu_tool.py read SOURCE_URL
```

Save the full output. This is the document to optimize.

**Analyze carefully:**
- Overall topic and purpose of the document
- Author's writing style and tone (formal/informal, technical/accessible)
- Existing heading structure and hierarchy
- Content organization and flow
- Level of detail in each section
- Use of formatting (bold, lists, code blocks, etc.)
- **Technical payload that must survive**: numbers, formulas, systems, complexity, deployment facts, experiment settings, citations, caveats, mechanism details

**Record your observations** — you will need them in Task 5 to preserve the original character.

### Task 2: Read Reference Document

```bash
python <skill-directory>/scripts/feishu_tool.py read DEST_URL
```

Save the full output. This is the format reference only — not a content source.

**Analyze the FORMAT only:**
- Heading hierarchy pattern (depth, naming conventions)
- Section organization template
- Formatting conventions (when bold is used, list styles, etc.)
- Content density and paragraph structure
- Use of structural elements (dividers, quotes, code blocks)

### Task 3: Format Analysis

Read [`references/optimization-guide.md`](<skill-directory>/references/optimization-guide.md) for the detailed comparison framework and known reference format patterns.

**Reference Discipline:**
- The optimization guide is a style reference, not a license to restyle the document wholesale
- Preserve the source document's macro-structure unless there is a clear formatting defect
- Do not renumber or deepen the heading hierarchy just to match the reference pattern if the source already has a stable hierarchy
- If an opening block, metadata block, or summary layout already works, prefer light cleanup over redesign
- Prefer blockquote-style callouts that round-trip correctly in exported markdown

Check the source document against these specific format conventions:

| Convention | Expected Pattern | Source Status |
|------------|-----------------|---------------|
| Opening callout | `[!callout]` with description + paper/repo links | Present? Missing? |
| Numbered headings | `## 1 标题` / `### 1.1 子标题` | Correct numbering? Duplicates? |
| Heading groups | No section resets — numbering is continuous across whole doc | Multiple `## 1` resets? |
| Level conflicts | Group/chapter titles at correct level vs. their sub-items | Any group title at same level as children? |
| Callouts/quotes | `\|>` / `[!callout]` / `> 📌` freely throughout (5–15 per long doc) | Enough callouts? TL;DR blocks styled? |
| Code block tags | Language tag on every code block | Any bare ` ``` `? |
| Bold key terms | First mention of important technical terms bolded | Applied? |
| Inline emphasis | `{red:...}` / `{red:**...**}` for key points (10–20× in a long doc); `{green:...}` for first-mention key terms (5–10×) | Enough red text? |
| LaTeX equations | `$inline$` and `$$display$$` | Correct syntax? |
| Formula placement | Formulas in normal paragraphs, not inside blockquotes/callouts | Any `$...$` inside `>`? |

**Hard Constraints:**
- Do **not** assume numbered headings are mandatory when the source already has a coherent hierarchy
- **Exception — Chinese ordinal headings are always a defect**: `## 一、`, `## 二、`, `## 三、`… use Chinese characters that do NOT trigger the tool's blue-number coloring. Always convert to `## 1 Title`, `## 2 Title`… format. This is not optional.
- Do **not** force extra subsection levels simply because the reference is more granular
- **All siblings at the same heading level must be consistently numbered or consistently unnumbered.** A lone unnumbered heading (e.g., `## Cheatsheet`) among numbered siblings must be assigned the next sequential number.
- Treat opening layout, metadata layout, and top-of-document summary layout as high-risk areas where over-editing is likely to regress the page
- Prefer blockquote-style callouts that round-trip correctly in exported markdown

**Important**: Only note FORMAT differences. Do not compare content topics.

### Task 4: Content Review (Light Touch)

Review the source document for issues that should be fixed regardless of format:

**Fix These:**
- **Factual errors**: Incorrect technical information, wrong version numbers, broken links
- **Incomplete descriptions**: Sentences that trail off, missing explanations, TODO/placeholder text
- **Obvious typos**: Spelling errors, grammar mistakes that change meaning
- **Broken formatting**: Unclosed markdown, inconsistent list indentation

**Do NOT Change:**
- **Author's tone**: If they write casually, keep it casual
- **Content focus**: If they emphasize certain topics, respect that emphasis
- **Technical opinions**: If they recommend a tool or approach, keep it
- **Original structure**: Only adjust structure if it clearly conflicts with the reference format
- **Level of detail**: If the author was brief on a topic, they may have had a reason

Read [`references/conservative-edits.md`](<skill-directory>/references/conservative-edits.md) for detailed guidelines on what changes are appropriate.

### Task 5: Generate Optimized Version

**CRITICAL**: Read this section carefully before writing.

#### The 80/20 Rule

The optimized document should be **80%+ identical** to the original. Changes should be subtle improvements, not rewrites.

#### What to change:

1. **Opening callout** — Add a `[!callout]` block at the top if missing
   - Use `[!callout icon=ICON bg=2 border=2]` — choose an appropriate icon freely (e.g. `gift`, `bulb`, `bookmark`, `pushpin`, `rocket`, `star`)
   - Put the document's intro description AND paper/code links **all inside** the callout as child paragraphs (separated by blank `>` lines)
   - Example:
     ```
     > [!callout icon=gift bg=2 border=2]
     > 本文档...的简介文字。
     >
     > **Paper**: [Title](url)
     >
     > **Code**: [GitHub](url)
     >
     ```
   - If the source already has an intro `|>` quote container or a plain `>` blockquote that functions as the document summary (e.g., `> 一句话总结: ...`), move its text into the callout as a child paragraph and remove the original block

2. **Heading restructuring** — Fix numbering AND hierarchy when needed:
   - Apply **continuous sequential numbering at all heading levels**: `## 1`, `## 2`… for top-level; `### 1.1`, `### 1.2`… for second-level; `#### 1.1.1`, `#### 1.1.2`… for third-level. Never leave any heading level unnumbered if its parent level is numbered.
   - **Number format**: Always use `## 1 Title` (number then space then title — **no period** after the number). The upload tool automatically colors the numeric prefix blue. Format `## 1. Title` (period after number) will NOT trigger auto-blue coloring.
   - **Heading groups**: If multiple independent sections each restart at "1.", "2."…, choose a fix:
     - *Elevate the group header*: if a heading like `## 深度推导：…` logically contains sub-items also at `##`, promote it to `#` and demote sub-items to `##`
     - *Continuous renumber*: if no clear group header exists, renumber all items sequentially (1, 2, 3, 4…)
   - **Level conflicts**: if a heading that groups several sub-sections is at the same `##` level as those sub-sections, promote it one level up (`##` → `#`, `###` → `##`, etc.)
   - **Renaming allowed**: you MAY revise a heading's title when it's too generic or doesn't capture the actual scope — keep the core topic, just improve precision
   - **Reordering allowed**: you MAY reorder sections when the logical flow clearly improves (e.g., prerequisite concepts before dependent ones) — note each reorder in the summary report

3. **Callouts and quote containers — use freely throughout the document**
   - **TL;DR blocks** → always convert to **blue callout**: `[!callout icon=bulb bg=2 border=2]` (NOT a `|>` quote container)
   - **"一句话总结" / "一句话定位" / "核心思想" / "关键结论"** → normally convert to **green callout**: `[!callout icon=pushpin bg=3 border=3]` (NOT a `|>` quote container); **exception**: if they contain `$...$`, `$$...$$`, or multiple inline equations, use normal body text or a nearby summary subsection instead
   - Add `|>` quote containers for other key insights, important observations, counterintuitive findings, and critical design decisions — no upper limit
   - Add `> 📌 **标题**: ...` blockquotes for critical facts and must-not-miss design decisions
   - A well-formatted long document should have **5–15 callouts/quote containers** spread across sections

   **Feishu Callout Syntax Rules:**
   - Use `> [!callout icon=...]` form, not a bare `[!callout ...]` line
   - Keep the callout marker and its body in the same blockquote group
   - If unsure whether a custom callout will round-trip correctly, use a plain `> 📌 ...` blockquote instead

   **Formula Safety Rules:**
   - Do **not** keep formula-bearing summaries inside blockquotes, callouts, or quote containers
   - If a summary sentence contains LaTeX, place it as a normal paragraph or a nearby summary subsection
   - If a sentence mixes prose and several formulas, prefer a normal paragraph
   - If the formula is the main payload, prefer a lead-in sentence plus a standalone display equation block

4. **Code block language tags** — Add missing language tags to bare code blocks

5. **Formatting conventions** — Apply reference patterns
   - Bold key technical terms on first mention
   - Use `inline code` for function names, variables, file paths

6. **Inline emphasis — MANDATORY**
   - Preserve ALL existing `{red:...}`, `{green:...}`, `**bold**`, `*italic*` from the source exactly
   - `{red:text}` / `{red:**text**}` — **red text color**, use **liberally throughout** (10–20× for a long technical paper). Mark key conclusions, important values, critical facts in every section.
   - `{green:text}` / `{green:**text**}` — **green background highlight** for key technical concepts/system names on first mention (5–10×)
   - `**bold**` — key technical terms, lead-in labels in lists
   - `*italic*` — terms being defined, foreign phrases, titles

   **Structural emphasis for scannability:**
   - **Bold structural signposts**: Bold ALL "在...方面" / "在...上" phrases that introduce a topic shift — e.g., "在内存优化方面" → "**在内存优化方面**", "在通信方面" → "**在通信方面**". Also bold: "**从...角度**", "**具体来说**", "**值得注意的是**", "**核心区别在于**"
   - **Bold enumeration lead-ins**: When a paragraph lists items inline, bold each item name
   - **Green-highlight enumerated technique names**: When a paragraph enumerates multiple technical techniques with Chinese glosses (e.g., "通过 A（中文A）、B（中文B）和 C"), apply `{green:...}` to each technique name on first mention
   - **Red for full conclusions**: Mark the complete finding, not just a number. Each section should have 1–2 red sentences.

   Rules:
   - Never mark entire paragraphs — but DO mark full key sentences/clauses that a reader must not miss
   - Red emphasis is reserved for conclusions and consequences, not routine explanatory clauses
   - Green emphasis is used on genuine first-mention concepts, not repeated on every prominent noun

7. **Factual corrections** — Fix identified errors from Task 4

8. **Description completion** — Flesh out incomplete sections
   - Add only information that is clearly implied or factually obvious
   - Do NOT fabricate details or add your own opinions

9. **Ordered list numbering** — Feishu does NOT auto-renumber ordered list items. If the source markdown uses `1.` for every item (a common Markdown habit), all items render as "1." in Feishu. Always use explicit sequential numbers: `1.`, `2.`, `3.`, `4.`…

10. **Intelligent list conversion** — Dense paragraphs that enumerate items should be broken into structured lists:
   - **When to convert**: A paragraph listing 3+ items/features/components with descriptions, separated by 、/；/semicolons
   - **Format**: Bullet list with bold lead-ins: `- **ItemName**: description`
   - **When NOT to convert**: Items are very short with no descriptions, or the enumeration is embedded in narrative flow

#### What NOT to change:

- **Author's tone and voice** — Colorful language (e.g., 灵魂拷问, 降维打击, 一句话总结) is intentional. Keep it.
- **Existing emphasis** — If the author used `{red:...}` or bold on something, that was intentional; don't remove or move it
- **Section scope** — Don't merge or split sections; don't change what each section covers
- **Technical examples and code snippets** — Preserve exactly
- **Author's analogies and explanations** — Their way of explaining is part of the value
- **Length** — Don't pad sections to match reference length
- **Author's personal insights or recommendations** — These are the core value of the document

#### Generating the output:

Produce the complete optimized markdown. Do NOT output a diff — output the full document.

### Task 5.5: Content Preservation Audit

Before proceeding to upload, check for:
- Dropped bullets or list items
- Shortened mechanism descriptions
- Removed numbers, formulas, complexity, thresholds
- Removed deployment/experiment/workload facts
- Removed citations or named systems
- Macro-structure drift: added or removed top-level sections, subsection splits, or heading renumbering not justified by a broken source
- Opening-layout drift: title-adjacent summary, author/meta block, and first visual block still feel like the source rather than a template rewrite

If any technical section is materially shorter, re-check it line by line.

### Task 5.6: Emphasis Audit

Before proceeding to upload, check for:
- At least 1 red conclusion in each major section
- Green first-mention highlights where new concepts appear
- Bold structural anchors
- Yellow highlights for caveats/tradeoffs where appropriate
- Emphasis density still matches the source tone; remove highlights if the page starts to feel over-marked or noisier than the reference
- Red emphasis is reserved for conclusions and consequences, not routine explanatory clauses
- Green emphasis is used on genuine first-mention concepts, not repeated on every prominent noun

### Task 5.7: Rendered-Layout Regression Check

Visually inspect the final markdown and reject it if any of these regressions appear:
- Opening callout or opening summary looks weaker than the source/reference
- Top metadata collapses into stray lines or duplicated blocks
- A clean source paragraph was turned into a noisier list, or a clean list into a denser paragraph
- Headings became more numerous or deeper without a clear readability win
- Emphasis feels materially louder than the source/reference
- Callout syntax is likely to render literally instead of as a Feishu callout

### Task 6: Write to Feishu

Determine an appropriate title. Use the source document's original title, optionally with a suffix.

Determine the image directory:
- If the source document contains images, the images were fetched from Feishu and may need re-upload. If you saved images locally during read, set `IMAGE_DIR` to their directory.
- If no images are present, omit `--image-dir`.

Write the optimized content to a temp file, then upload:

```bash
# Step 1: Write optimized content to a temp file using the Write tool
# (write the full optimized markdown — NO H1 line — to this path)
UPLOAD_TMP=$(mktemp /tmp/feishu_upload_XXXXXX.md)

# Step 2: Upload from file (auto-retries failed image uploads)
python <skill-directory>/scripts/feishu_tool.py write DEST_URL \
  --heading-color \
  --image-dir "IMAGE_DIR" \
  --title "TITLE" \
  --input-file "$UPLOAD_TMP"

# Step 3: Clean up temp file
rm -f "$UPLOAD_TMP"
```

**Important notes for writing:**
- Always include `--heading-color` to auto-color headings by depth (required for visual formatting)
- Include `--image-dir` when the document contains images; omit when it doesn't
- **Do NOT include a `# Title` H1 line in the content body.** The page title is set via `--title`. If H1 is in the body, it shifts heading depth by 1 and all headings get the wrong color (orange instead of red for top-level `##` sections).
- The `--input-file` approach avoids shell escaping issues and enables image upload auto-retry

The script prints the URL of the newly created page. **Share this URL with the user.**

#### Post-write verification:

After writing, optionally verify by reading back:
```bash
python <skill-directory>/scripts/feishu_tool.py read NEW_PAGE_URL
```

### Summary Report

After completing all tasks, provide the user with:

1. **URL** of the new page
2. **Changes made** — brief list of what was modified
3. **Confidence level** — how confident you are in the changes

### Reference Files

Load these as needed for detailed guidance:

- **Optimization guide**: [`references/optimization-guide.md`](<skill-directory>/references/optimization-guide.md)
- **Conservative edits**: [`references/conservative-edits.md`](<skill-directory>/references/conservative-edits.md)

---

## Action: copy

Copy wiki pages between locations with full fidelity (text, images, tables, formatting).

```bash
python <skill-directory>/scripts/feishu_tool.py copy SOURCE_URL TARGET_URL [options]
```

Options:
- `-r` — Recursive: copy all subpages
- `-n` — Add auto-numbered headings (1.1, 1.2)
- `--fix-refs` — Fix internal references in copies
- `--title "Title"` — Override page title
- `-v` — Verbose output

The script prints the new page URL to stdout.

---

## Action: sync

Incremental sync — only copies new or modified pages on subsequent runs. State is persisted in `~/log/feishu_tools/sync_logs/state/`.

```bash
python <skill-directory>/scripts/feishu_tool.py sync SOURCE_URL TARGET_URL [options]
```

Options:
- `-n` — Add auto-numbered headings
- `--no-fix-refs` — Skip reference remapping
- `--title "Title"` — Custom root page title
- `-v` — Verbose output

First run performs a full copy. Subsequent runs detect NEW/MODIFIED/DELETED pages and sync incrementally.

---

## Action: export

Export wiki pages and subpages to local markdown files with images.

```bash
python <skill-directory>/scripts/feishu_tool.py export SOURCE_URL [-o DIR]
```

Options:
- `-o DIR` — Output directory (default: `wiki_output`)
- `-v` — Verbose output

Creates a directory tree with `.md` files and `images/` subdirectories.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| OAuth prompt on first run | Follow the printed authorization URL, then re-run |
| Token expired | Delete `.feishu_token_cache.json` and re-run |
| "Only docx pages supported" | The page is a sheet/bitable/etc., not a document |
| Permission denied | Add required scopes to your Feishu app: `wiki:wiki`, `docx:document`, `drive:drive` |
