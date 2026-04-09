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

## 14 Real-World HTML In Tables (GTC)

These cases represent actual HTML semantics found in GTC catalog markdown:
list items inside table cells, line breaks, mixed bold/italic tags.

| Code | Title | Abstract |
|---|---|---|
| R-001 | ul-li with bold | Prerequisites:<ul><li><strong>PyTorch</strong></li><li><strong>CUDA 12+</strong></li></ul> |
| R-002 | Nested p+ul | Intro paragraph.<ul><li>Point one</li><li>Point two</li></ul>After list. |
| R-003 | br line breaks | First paragraph.<br>Second paragraph.<br>Third paragraph. |
| R-004 | mixed strong+b | Text with <strong>strong</strong> and <b>bold tag</b>. |
| R-005 | ul with links | <ul><li>[NVIDIA](https://nvidia.com)</li><li>[GitHub](https://github.com)</li></ul> |
| R-006 | multi-block cell | Intro.<ul><li>Item A</li><li>Item B</li></ul>Conclusion with **bold**. |
| R-007 | li with code | <ul><li>`import torch`</li><li>`pip install`</li></ul> |
| R-008 | empty li | <ul><li>Has content</li><li></li></ul> |

## 15 Highlight Tags

| Code | Title | Abstract |
|---|---|---|
| HL-001 | Single highlight | Session about {red:**CUDA**} programming. |
| HL-002 | Multiple highlights | Covers {red:**PyTorch**} and {red:**TensorFlow**}. |
| HL-003 | No highlight | This cell has no highlight tags. |
| HL-004 | Green inline | Use {green:`Asia/Singapore`} for the timezone. |
| HL-005 | Red plain | The {red:LC_ALL} override breaks locale. |

## Extra — GTC Real-World HTML Semantics

These cases come from actual GTC catalog markdown: list items inside table cells,
line breaks, mixed bold/italic tags, multi-paragraph cells.

| Code | Title | Abstract |
|---|---|---|
| H-001 | ul-li in cell | <p>Prerequisites:</p><ul><li><strong>PyTorch</strong></li><li><strong>CUDA 12+</strong></li><li>Python 3.10</li></ul> |
| H-002 | ul-li with links | <p>Resources:</p><ul><li><a href="https://nvidia.com">NVIDIA</a></li><li><a href="https://github.com">GitHub</a></li></ul> |
| H-003 | ul-li with bold | <ul><li><strong>Bold item</strong></li><li><b>Another bold</b></li><li>Plain item</li></ul> |
| H-004 | br line breaks | <p>First paragraph.</p><br><p>Second paragraph after break.</p><br><p>Third paragraph.</p> |
| H-005 | br in cell end | Start text.<br><br>More text.<br>Final line. |
| H-006 | strong+b+i+em | Text with <strong>strong</strong> and <b>bold</b> and <em>italic</em> and <i>italic2</i>. |
| H-007 | p inside ul-li | <ul><li><p>Item with paragraph</p></li><li><p>Second item</p></li></ul> |
| H-008 | complex nested | <p>Intro text.</p><ul><li><strong>Bold item</strong> with <a href="https://x.com">link</a></li><li><b>B tag</b> and <i>italic</i></li></ul><p>After list.</p> |
| H-009 | empty li | <ul><li>Has content</li><li></li></ul> |
| H-010 | li with code | <ul><li>First with `inline code`</li><li>Second plain</li></ul> |

## 16 Paragraph in Cells (regression: <p> must produce newlines, not spaces)

| Code | Title | Abstract |
|---|---|---|
| P-001 | Two paragraphs | <p>First paragraph.</p> <p>Second paragraph.</p> |
| P-002 | Three paragraphs | <p>Paragraph one.</p> <p>Paragraph two.</p> <p>Paragraph three.</p> |
| P-003 | Paragraph with bold | <p>Intro with <strong>bold</strong>.</p> <p>Detail with <b>b tag</b>.</p> |
| P-004 | Paragraph before Important | <p>Main abstract text.</p> <p><strong>Important:</strong> session details here.</p> |
| P-005 | Paragraph with list | <p>Prerequisites:</p> <ul><li><strong>PyTorch</strong></li><li>CUDA 12</li></ul> |

## 17 Escaped Pipe in Cells (regression: \| must NOT be a column separator)

| Code | Title | Abstract |
|---|---|---|
| EP-001 | Pipe in link text | See [Install Guide \| Notice](https://example.com/guide) for details. |
| EP-002 | Pipe in code | Use `grep \| sort \| uniq` to count unique items. |
| EP-003 | Mixed content | Text with <a href="https://x.com/a?a=1\|b=2">link \| more</a> and **bold \| text**. |
| EP-004 | Multiple pipes | Command: `cmd1 \| cmd2 \| cmd3` with [Doc A \| Doc B](https://x.com). |
| EP-005 | Single escaped pipe | Text with \| pipe in cell. |
| EP-006 | S82795 regression | See [Install & Demo Guide \| Notice & Disclaimers](https://example.com/guide) for details. |

## 18 Mermaid Block (add-ons passthrough)

<add-ons component-id="" component-type-id="blk_631fefbbae02400430b8f9f4" record="{"data":"graph TD\n    %% --- Style Definitions ---\n    classDef depth fill:#ffcccc,stroke:#ff0000,stroke-width:2px;\n    classDef perc fill:#cce5ff,stroke:#0066cc,stroke-width:2px;\n    classDef plan fill:#d5fdd5,stroke:#009900,stroke-width:2px;\n    classDef loss fill:#eee,stroke:#999,stroke-width:1px,stroke-dasharray: 3 3;\n    classDef data fill:#fdfdfd,stroke:#999,stroke-dasharray: 5 5;\n    classDef process fill:#fff,stroke:#333;\n\n    %% --- Stage 1: Image Encoder ---\n    subgraph Stage_1_Image_Encoder [Stage 1: Image Encoder]\n        direction TB\n        Img(Input Images) --\u003e Backbone[ResNet Backbone]:::process\n        Backbone --\u003e Neck[FPN Neck]:::process\n        Neck --\u003e FeatMap(Feature Maps I):::data\n        \n        %% [Refinement] Training-only branch: Connected to Loss\n        FeatMap -.-\u003e|Training Input| DepthHead(🔴 Depth Head):::depth\n        DepthHead -.-\u003e|Calculate L1 Loss| LossDepth(Depth Loss / Loss_depth):::loss\n    end\n\n    %% --- Stage 2: Sparse Perception ---\n    subgraph Stage_2_Sparse_Perception [Stage 2: Symmetric Sparse Perception]\n        direction TB\n        InitProbe(K-Means Initial Probes):::data --\u003e LoopStart\n        \n        subgraph Loop [6-Layer Decoder Loop]\n            direction TB\n            LoopStart(Deformable Aggregation):::process\n            LoopStart --\u003e|Extract Features| ProbeFeat(Probe Features):::data\n            ProbeFeat --\u003e PercHead(🔵 Detection \u0026 Mapping Heads):::perc\n            PercHead --\u003e|Regress Offset / Refine Coords| LoopStart\n        end\n        \n        %% Perception Loss (Training)\n        PercHead -.-\u003e|Calculate Cls \u0026 Reg Loss| LossPerc(Perception Loss / Loss_det/map):::loss\n        \n        FeatMap --\u003e LoopStart\n    end\n\n    %% --- Ego Initialization Shortcut ---\n    subgraph Ego_Init [Ego Initialization]\n        FeatMap --\u003e|Front View Min Scale + AvgPool| EgoFeat(Ego Feature):::data\n    end\n\n    %% --- Stage 3: Motion Planner ---\n    subgraph Stage_3_Motion_Planner [Stage 3: Parallel Motion Planner]\n        direction TB\n        PercHead --\u003e|Obstacle / Map Agents| Interaction[Spatio-Temporal Interaction / Attention]:::process\n        EgoFeat --\u003e|Ego Agent| Interaction\n        \n        Interaction --\u003e FinalFeat(Post-Interaction Features):::data\n        \n        FinalFeat --\u003e PredHead(🟢 Motion Prediction Head):::plan\n        FinalFeat --\u003e PlanHead(🟢 Planning Head):::plan\n        \n        %% Planning Loss (Training)\n        PlanHead -.-\u003e|Calculate Planning Loss| LossPlan(Planning Loss / Loss_plan):::loss\n    end\n\n    %% --- Final Output ---\n    PlanHead --\u003e|Final Trajectory| Control(Vehicle Control / Output)\n","theme":"base","view":"chart"}"/>

## 19 Callout DSL Conversion

[!callout emoji="rocket" background-color="light-blue" border-color="light-blue"]
DSL callout body text here.
[/callout]

This section tests that bracket-DSL callout syntax converts to XML and content is preserved.

[!callout emoji="pushpin" background-color="light-green" border-color="light-green"]
Second DSL callout with **bold** and `code` inside.
[/callout]

## 15 Verification Targets

- Heading numbering should remain visible.
- Heading background patch targets should accept post-write styling.
- Inline rich text should render in paragraphs and in table cells.
- Official strict callout syntax should render consistently.
- Ordered list behavior must be checked separately from heading numbering.
- Read-back normalization rules should be derivable from returned markdown.
- HTML tags (paragraph, list, link, bold) must be fully converted.
- Chinese ordinals (一、二、) must normalize to Arabic numbers.
- Bullet items in table cells must convert to separate blocks.
