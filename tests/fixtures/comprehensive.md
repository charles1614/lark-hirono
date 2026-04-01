# Comprehensive Pipeline Test

Tests the full feishu-custom pipeline: normalize → preprocess → lark-table → highlight.

Superset of feishu-official-capabilities/fixtures/comprehensive.md plus HTML/GTC-specific cases.

---

## 1 Heading Matrix

### 1.1 Plain headings

#### 1.1.1 Deep heading plain

##### 1.1.1.1 Fifth-level heading plain

### 1.2 Colored headings {color="red"}

#### 1.2.1 Colored child {color="green"}

### 1.3 Center aligned heading {color="blue" align="center"}

#### 1.3.1 Purple child {color="purple"}

### 1.4 Heading background patch targets

#### 1.4.1 Patch target A

#### 1.4.2 Patch target B

## 2 Inline Rich Text

Plain paragraph with **bold**, *italic*, `inline code`, ~~strike~~, <u>underline</u>, [example](https://example.com), <text color="red">red text</text>, <text background-color="yellow">yellow background</text>, and mixed **bold + <text color="blue">color</text>** text.

中文 English mixed paragraph with <text color="purple">重点</text>, `路径/path/to/file`, and [链接](https://example.com/zh).

Another paragraph with **[bold link](https://example.com)** and multiple [links](https://a.com) in [one](https://b.com) sentence.

## 3 List Matrix

### 3.1 Unordered

- Bullet one
- Bullet two with [link](https://example.com/list)
- Bullet three with `inline code`
  - Nested bullet A
  - Nested bullet B with <text background-color="green">tag</text>

### 3.2 Ordered

1. First numbered item
2. Second numbered item with **bold** text
3. Third numbered item with <text background-color="green">tag</text>
   1. Nested ordered one
   2. Nested ordered two

### 3.3 Todo

- [ ] Open item
- [x] Completed item

## 4 Callout / Quote Matrix

> 📌 **Insight**: Simple quote block control.

<callout emoji="💡" background-color="light-blue" border-color="blue">
Callout with paragraph.

- Bullet inside callout
- Second bullet inside callout

## Nested heading in callout

More text in callout.
</callout>

<callout emoji="⚠️" background-color="light-yellow" border-color="yellow">
Warning callout with **bold** and `code`.
</callout>

## 5 Code and Equation Matrix

```python
print("hello feishu")
```

```bash
echo "shell block"
```

Inline equation: <equation>E = mc^2</equation>

Display equation:
<equation>a^2 + b^2 = c^2</equation>

## 6 HTML → Markdown (GTC-style)

### 6.1 Paragraph tags

<p>Single paragraph with <strong>bold</strong> and <a href="https://nvidia.com">link</a>.</p>

<p>First line of multi-line.</p>
<p>Second line continues.</p>

### 6.2 List tags

<ul>
<li><strong>PyTorch</strong></li>
<li><strong>CUDA 12+</strong></li>
<li>Python 3.10</li>
</ul>

<p>After the list, see <a href="https://example.com">documentation</a> for details.</p>

### 6.3 Mixed HTML

<p>Uses <strong>strong</strong> and <b>b tag</b> and <em>em</em> and <i>i tag</i>.</p>
<ul>
<li>Item with <a href="https://x.com">link inside list</a></li>
<li>Item with <strong>bold inside list</strong></li>
</ul>

## 7 Table Matrix (simple markdown)

| Name | Type | Note |
|---|---|---|
| Alpha | <text background-color="green">AI</text> | First row |
| Beta | <text background-color="blue">System</text> | Second row |
| Gamma | <text background-color="orange">Ops</text> | Third row |

## 8 Table Matrix (strict lark-table)

<lark-table column-widths="120,160,540" header-row="true">
<lark-tr>
<lark-td>

**Case**

</lark-td>
<lark-td>

**Expected**

</lark-td>
<lark-td>

**Sample**

</lark-td>
</lark-tr>
<lark-tr>
<lark-td>

inline-rich

</lark-td>
<lark-td>

cell rich text rendering

</lark-td>
<lark-td>

**bold**

*italic*

`code`

~~strike~~

<text color="red">critical</text>

<text background-color="green">tag</text>

<text background-color="blue">system</text>

</lark-td>
</lark-tr>
<lark-tr>
<lark-td>

multiline

</lark-td>
<lark-td>

cell multiline paragraphs

</lark-td>
<lark-td>

First line

Second line

Third line

</lark-td>
</lark-tr>
<lark-tr>
<lark-td>

unordered-list

</lark-td>
<lark-td>

cell list rendering

</lark-td>
<lark-td>

- item A
- item B
- item C

</lark-td>
</lark-tr>
<lark-tr>
<lark-td>

ordered-list

</lark-td>
<lark-td>

cell ordered list rendering

</lark-td>
<lark-td>

1. first
2. second
3. third

</lark-td>
</lark-tr>
<lark-tr>
<lark-td>

links

</lark-td>
<lark-td>

cell links rendering

</lark-td>
<lark-td>

[example](https://example.com)

[reference link](https://example.com/ref)

</lark-td>
</lark-tr>
<lark-tr>
<lark-td>

formula

</lark-td>
<lark-td>

cell equation rendering

</lark-td>
<lark-td>

<equation>E = mc^2</equation>

</lark-td>
</lark-tr>
<lark-tr>
<lark-td>

mixed

</lark-td>
<lark-td>

multiple block types in one cell

</lark-td>
<lark-td>

Start with **bold text**.

- bullet inside cell
- second bullet with `code`

<callout emoji="💡" background-color="light-green" border-color="green">
cell callout content
</callout>

Final line with <text color="red">highlight</text> and [link](https://example.com/mixed).

</lark-td>
</lark-tr>
</lark-table>

## 9 Table — HTML Sessions (GTC-style, converted via normalize → lark-table)

| Code | Title | Abstract |
|---|---|---|
| HTML-001 | Basic paragraph | <p>Simple paragraph text.</p> |
| HTML-002 | Multi-line paragraph | <p>First line.</p><p>Second line.</p> |
| HTML-003 | Unordered list | <p>Prerequisites:</p><ul><li><strong>PyTorch</strong></li><li><strong>CUDA 12+</strong></li><li>Python 3.10</li></ul> |
| HTML-004 | Links in cell | <p>See <a href="https://example.com">documentation</a> and <a href="https://nvidia.com">NVIDIA</a>.</p> |
| HTML-005 | Bold variants | <p>Uses <strong>strong tag</strong> and <b>b tag</b>.</p> |
| HTML-006 | Mixed HTML | <p>Start with <strong>bold</strong>. Then <a href="https://x.com">a link</a>.</p><ul><li>See <a href="https://y.com">guide</a></li><li>Requires <b>CUDA</b></li></ul> |
| HTML-007 | Line break | <p>First line.</p><br><p>After break.</p> |
| HTML-008 | Empty cell |  |
| HTML-009 | Plain text | No HTML at all in this cell. |
| HTML-010 | Escaped pipe | Value with \| escaped pipe. |

## 10 Table — Rich Text Sessions

| Code | Title | Abstract |
|---|---|---|
| RT-001 | Bold text | This uses **bold text** for emphasis. |
| RT-002 | Italic text | This uses *italic text* for style. |
| RT-003 | Code inline | Use `pip install torch` to install. |
| RT-004 | Link only | See [documentation](https://example.com) for details. |
| RT-005 | Colored text | Marked as <text color="red">red warning</text> status. |
| RT-006 | Background text | Approved as <text background-color="green">approved</text>. |
| RT-007 | Mixed formatting | **Bold** with *italic*, `code`, and [link](https://example.com). |
| RT-008 | Chinese mixed | 中文包含 **加粗** 和 [链接](https://example.com/zh)。 |
| RT-009 | Cell bullets | Requirements:<br>- **GPU**: A100 or H100<br>- **RAM**: 64GB+<br>- **Storage**: 100GB |
| RT-010 | Cell links | See [paper](https://arxiv.org/abs/1234) and [code](https://github.com/example). |

## 11 Heading Normalization

## 一、Chinese Ordinal First

Content under Chinese heading.

| Code | Title |
|---|---|
| CN-001 | Item one |

## 二、Chinese Ordinal Second

Content under second Chinese heading.

## 12 Misc Controls

<grid cols="2">
<column>

Left column with **bold** text.

</column>
<column>

Right column with <text color="blue">blue text</text>.

</column>
</grid>

## 13 Edge Cases

Long paragraph: This is an extremely long session title that tests how the pipeline handles titles that are much longer than typical session names and might cause layout issues in tables.

Special characters: (parentheses), [brackets], {braces}, <angles>, "quotes", 'apostrophes', `backticks`.

## 14 Highlight Tags

| Code | Title | Abstract |
|---|---|---|
| HL-001 | Single highlight | Session about {red:**CUDA**} programming. |
| HL-002 | Multiple highlights | Covers {red:**PyTorch**} and {red:**TensorFlow**}. |
| HL-003 | No highlight | This cell has no highlight tags. |

## 15 Verification Targets

- Heading numbering should remain visible.
- Heading background patch targets should accept post-write styling.
- Inline rich text should render in paragraphs and in table cells.
- Official strict callout syntax should render consistently.
- Ordered list behavior must be checked separately from heading numbering.
- Read-back normalization rules should be derivable from returned markdown.
- HTML tags (`<p>`, `<ul>`, `<li>`, `<a>`, `<strong>`) must be fully converted.
- Chinese ordinals (一、二、) must normalize to Arabic numbers.
- Bullet items in table cells must convert to separate blocks.
