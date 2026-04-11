#!/usr/bin/env bash
# tests/comprehensive-test.sh
# Dry-run test: verify pipeline preprocessing output.
# Each section is verified independently so a broken section cannot be masked.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
FIXTURE="$SCRIPT_DIR/fixtures/comprehensive.md"
OUTPUT="/tmp/feishu-comprehensive-test-output.md"

PASS=0
FAIL=0

# Ensure compiled output is up to date before running tests
cd "$PROJECT_DIR"
npm run build --silent 2>/dev/null || { echo "ERROR: build failed"; exit 1; }

check() {
  local desc="$1"; local pattern="$2"
  if grep -qF -- "$pattern" <<<"$OUTPUT_CONTENT"; then
    echo "  ✅ $desc"; PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"; FAIL=$((FAIL + 1))
  fi
}

check_regex() {
  local desc="$1"; local pattern="$2"
  if grep -qE -- "$pattern" <<<"$OUTPUT_CONTENT"; then
    echo "  ✅ $desc"; PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"; FAIL=$((FAIL + 1))
  fi
}

check_not() {
  local desc="$1"; local pattern="$2"
  if grep -qF -- "$pattern" <<<"$OUTPUT_CONTENT"; then
    echo "  ❌ $desc (should not contain: $pattern)"; FAIL=$((FAIL + 1))
  else
    echo "  ✅ $desc"; PASS=$((PASS + 1))
  fi
}

check_count() {
  local desc="$1"; local pattern="$2"; local min="$3"
  local actual; actual=$(grep -cF -- "$pattern" <<<"$OUTPUT_CONTENT" || true)
  if [ "$actual" -ge "$min" ]; then
    echo "  ✅ $desc ($actual >= $min)"; PASS=$((PASS + 1))
  else
    echo "  ❌ $desc ($actual < $min)"; FAIL=$((FAIL + 1))
  fi
}

section_content() {
  local start_pat="$1"
  local end_pat="$2"
  echo "$OUTPUT_CONTENT" | awk -v s="$start_pat" -v e="$end_pat" '
    $0 ~ s { found=1; next }
    $0 ~ e { found=0 }
    found { print }
  '
}

cd "$PROJECT_DIR"
echo "Running pipeline --dry-run --no-highlight ..."
if ! npx tsx src/pipeline.ts "$FIXTURE" "Comprehensive Test" --dry-run --no-highlight > "$OUTPUT"; then
  echo "ERROR: pipeline dry-run failed"
  exit 1
fi
OUTPUT_CONTENT=$(cat "$OUTPUT")

echo ""
echo "=== 1. Heading Matrix ==="
check "Plain heading" 'Plain headings'
check "Colored heading preserved" 'color="red"'
check "Deep heading" 'Deep heading plain'
check "Blue numbering" 'color="blue">'

echo ""
echo "=== 2. Inline Rich Text ==="
check "Bold" '**bold**'
check "Italic" '*italic*'
check "Inline code" '`inline code`'
check "Strikethrough" '~~strike~~'
check "Underline text" "underline"
check "Colored text" '<text color="red">red text</text>'
check "Background text" 'background-color="light-yellow"'
check "Chinese text" "中文"
check "Links in paragraph" '[example]'

echo ""
echo "=== 3. List Matrix ==="
check "Unordered bullets" 'Bullet one'
check "Nested bullets" 'Nested bullet'
check "Ordered list" 'First numbered'
check "Todo open" 'Open'
check "Todo completed" 'Completed'

echo ""
echo "=== 4. Callout / Quote ==="
check "Blockquote" '📌 **Insight**'
check "Callout block" '<callout'
check "Callout with bullets" 'Bullet inside callout'

echo ""
echo "=== 5. Code and Equation ==="
check "Python code block" '```python'
check "Inline equation" '$E = mc'
check "Subscript protection in math" '$\text{A}\mkern0mu_{B}$'
check "Inline code math-like text unchanged" '`code $A}_{B}$`'

echo ""
echo "=== 6. HTML → Markdown ==="
check_not "No <p> tags" '</p>'
check_not "No <ul> tags" '<ul>'
check_not "No <li> tags" '<li>'
check_not "No <strong>" '<strong>'
check "Links preserved" '[documentation]'
check "Bold from strong" '**PyTorch**'
check "Bullet items from <li>" 'CUDA 12'

echo ""
echo "=== 7. Table — simple markdown ==="
S7=$(section_content 'color="blue">7 ' 'color="blue">8 ')
if grep -qF -- 'rows="4"' <<<"$S7"; then echo "  ✅ Section 7 table rows=4"; PASS=$((PASS+1)); else echo "  ❌ Section 7 rows"; FAIL=$((FAIL+1)); fi
check "Alpha row preserved" 'Alpha'

echo ""
echo "=== 8. Table — strict lark-table ==="
S8=$(section_content 'color="blue">8 ' 'color="blue">9 ')
check "Strict table cells" 'inline-rich'
check "Ordered list in cell" 'first'
# Bug fix: # inside <lark-td> is plain text — lark-cli does not interpret it as a heading.
# The pipeline must NOT escape it to \# (which renders as literal backslash-hash in Feishu).
if grep -qF -- '# of cycles where the tensor pipe was active' <<<"$S8"; then echo "  ✅ Strict table: leading # preserved as plain text (not escaped)"; PASS=$((PASS+1)); else echo "  ❌ Strict table: leading # MISSING from output"; FAIL=$((FAIL+1)); fi
if grep -qF -- '\# of cycles where the tensor pipe was active' <<<"$S8"; then echo "  ❌ Strict table: # incorrectly escaped to \\# (Bug 1 regression)"; FAIL=$((FAIL+1)); else echo "  ✅ Strict table: no spurious \\# escape"; PASS=$((PASS+1)); fi
# Bug fix: ***content*** with __ underscores — lark-cli treats __ as bold markers, stripping
# the ** from *** and leaving only *content* (italic). The pipeline escapes __ → \_\_ inside
# bold/italic spans so lark-cli's parser sees them as literal underscores.
if grep -qF -- '***sm\_\_throughput.avg.pct_of_peak_sustained_elapsed***' <<<"$S8"; then echo "  ✅ Strict table: __ escaped inside ***...*** (Bug 2 fix)"; PASS=$((PASS+1)); else echo "  ❌ Strict table: __ NOT escaped inside ***...*** (Bug 2 regression)"; FAIL=$((FAIL+1)); fi
if grep -qF -- '***sm__throughput' <<<"$S8"; then echo "  ❌ Strict table: raw __ inside ***...*** still present (Bug 2 regression)"; FAIL=$((FAIL+1)); else echo "  ✅ Strict table: no raw __ inside ***...***"; PASS=$((PASS+1)); fi
if grep -qF -- '<callout emoji="clipboard" background-color="light-gray"' <<<"$S8"; then echo "  ✅ quote-container → callout converted (light-gray)"; PASS=$((PASS+1)); else echo "  ❌ quote-container NOT converted to callout"; FAIL=$((FAIL+1)); fi
if grep -qF -- '<quote-container>' <<<"$S8"; then echo "  ❌ raw <quote-container> still present in output"; FAIL=$((FAIL+1)); else echo "  ✅ no raw <quote-container> in output"; PASS=$((PASS+1)); fi
if grep -qF -- 'Description line one' <<<"$S8"; then echo "  ✅ quote-container body content preserved"; PASS=$((PASS+1)); else echo "  ❌ quote-container body content MISSING"; FAIL=$((FAIL+1)); fi

PATCH_CHECK=$(node --input-type=module -e 'import { computePatches } from "./dist/src/patch/patch.js"; const blocks=[{block_id:"doc",block_type:1,parent_id:""},{block_id:"table",block_type:31,parent_id:"doc"},{block_id:"cell",block_type:32,parent_id:"table"},{block_id:"bad",block_type:3,parent_id:"cell"},{block_id:"h2",block_type:4,parent_id:"doc"}]; const patches=computePatches(blocks,"light"); const h2=patches.find(p=>p.blockId==="h2"); const bad=patches.find(p=>p.blockId==="bad"); console.log(`${h2?.bg ?? "missing"} ${bad ? "bad" : "nobad"}`);')
if [[ "$PATCH_CHECK" == "LightRedBackground nobad" ]]; then echo "  ✅ Table-contained headings ignored for background depth"; PASS=$((PASS+1)); else echo "  ❌ Table-contained heading patch behavior wrong: $PATCH_CHECK"; FAIL=$((FAIL+1)); fi

echo ""
echo "=== 9. Table — HTML sessions ==="
S9=$(section_content 'color="blue">9 ' 'color="blue">10 ')
if grep -qF -- 'rows="11"' <<<"$S9"; then echo "  ✅ Section 9 rows=11"; PASS=$((PASS+1)); else echo "  ❌ Section 9 rows WRONG"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'cols="3"' <<<"$S9"; then echo "  ✅ Section 9 cols=3"; PASS=$((PASS+1)); else echo "  ❌ Section 9 cols"; FAIL=$((FAIL+1)); fi
for code in 001 002 003 004 005 006 007 008 009 010; do
  if grep -qF -- "HTML-$code" <<<"$S9"; then echo "  ✅ HTML-$code in table"; PASS=$((PASS+1)); else echo "  ❌ HTML-$code MISSING"; FAIL=$((FAIL+1)); fi
done
check "<li> → bullet in cell" 'PyTorch'
check "Links in cell" '[documentation](https://example.com)'

echo ""
echo "=== 10. Table — Rich Text Sessions ==="
S10=$(section_content 'color="blue">10 ' 'color="blue">11 ')
if grep -qF -- 'rows="11"' <<<"$S10"; then echo "  ✅ Section 10 rows=11"; PASS=$((PASS+1)); else echo "  ❌ Section 10 rows"; FAIL=$((FAIL+1)); fi
for code in RT-001 RT-002 RT-003 RT-004 RT-005 RT-006 RT-007 RT-008 RT-009 RT-010; do
  if grep -qF -- "$code" <<<"$S10"; then echo "  ✅ $code in table"; PASS=$((PASS+1)); else echo "  ❌ $code MISSING"; FAIL=$((FAIL+1)); fi
done

echo ""
echo "=== 11. Heading Normalization ==="
S11=$(section_content 'color="blue">11 ' 'color="blue">14 ')
if grep -qF -- 'color="blue">12 </text>Chinese Ordinal First' <<<"$S11"; then echo "  ✅ Chinese → 12"; PASS=$((PASS+1)); else echo "  ❌ Chinese → 12"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'color="blue">13 </text>Chinese Ordinal Second' <<<"$S11"; then echo "  ✅ Chinese → 13"; PASS=$((PASS+1)); else echo "  ❌ Chinese → 13"; FAIL=$((FAIL+1)); fi

echo ""
echo "=== 12. Misc Controls ==="
check "Grid block" '<grid'
check "Column block" '<column>'

echo ""
echo "=== 13. Edge Cases ==="
check "Escaped pipe" 'escaped pipe'
check "Long title" 'extremely long session'

echo ""
echo "=== 15. Inline Color Tags ==="
if grep -qF -- 'color="green">`Asia/Singapore`' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 15: {green:code} → <text color=\"green\">"; PASS=$((PASS+1)); else echo "  ❌ 15: {green:code} NOT converted"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'color="red">LC_ALL' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 15: {red:plain} → <text color=\"red\">"; PASS=$((PASS+1)); else echo "  ❌ 15: {red:plain} NOT converted"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'color="red">**CUDA**' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 15: {red:**bold**} still works"; PASS=$((PASS+1)); else echo "  ❌ 15: {red:**bold**} broken"; FAIL=$((FAIL+1)); fi

echo ""
echo "=== 14. No Residual HTML ==="
check_not "No <p>" '</p>'
check_not "No <ul>" '<ul>'
check_not "No <ol>" '<ol>'
check_not "No <li>" '<li>'
check_not "No <strong>" '<strong>'
check_not "No <b>" '<b>'
check_not "No <em>" '<em>'
check_not "No <i>" '<i>'

echo ""
echo "=== 16. Paragraph in Cells (newline regression) ==="
S16=$(section_content 'color="blue">16 ' 'color="blue">15 ')
check_not "16: No <p> in output" '<p>'
check_not "16: No </p> in output" '</p>'
if grep -qF -- 'First paragraph' <<<"$S16"; then echo "  ✅ 16: P-001 first paragraph preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-001 first paragraph MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Second paragraph' <<<"$S16"; then echo "  ✅ 16: P-001 second paragraph preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-001 second paragraph MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Main abstract text' <<<"$S16"; then echo "  ✅ 16: P-004 abstract text preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-004 abstract text MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- '**Important:**' <<<"$S16"; then echo "  ✅ 16: P-004 Important bold preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-004 Important bold MISSING"; FAIL=$((FAIL+1)); fi
# P-001: two paragraphs should be on separate lines (not space-joined)
# With empty line separator: grep -A2 catches it
if echo "$S16" | grep -A2 'First paragraph' | grep -q 'Second paragraph'; then echo "  ✅ 16: P-001 paragraphs on separate lines"; PASS=$((PASS+1)); else echo "  ❌ 16: P-001 paragraphs NOT on separate lines"; FAIL=$((FAIL+1)); fi

echo ""
echo "=== 17. Escaped Pipe in Cells (regression) ==="
S17=$(section_content 'color="blue">17 ' 'color="blue">15 ')
if grep -qF -- 'rows="7"' <<<"$S17"; then echo "  ✅ 17: Section 17 rows=7"; PASS=$((PASS+1)); else echo "  ❌ 17: Section 17 rows WRONG"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'cols="3"' <<<"$S17"; then echo "  ✅ 17: Section 17 cols=3"; PASS=$((PASS+1)); else echo "  ❌ 17: Section 17 cols WRONG"; FAIL=$((FAIL+1)); fi
for code in EP-001 EP-002 EP-003 EP-004 EP-005 EP-006; do
  if grep -qF -- "$code" <<<"$S17"; then echo "  ✅ 17: $code in table"; PASS=$((PASS+1)); else echo "  ❌ 17: $code MISSING"; FAIL=$((FAIL+1)); fi
done
if grep -qF -- 'Install Guide | Notice' <<<"$S17"; then echo "  ✅ 17: EP-001 escaped pipe in link preserved"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-001 escaped pipe broken"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'pipe in cell' <<<"$S17"; then echo "  ✅ 17: EP-005 escaped pipe preserved in cell"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-005 escaped pipe broken"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'grep | sort | uniq' <<<"$S17"; then echo "  ✅ 17: EP-002 escaped pipes in code preserved"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-002 escaped pipes broken"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Install & Demo Guide | Notice & Disclaimers' <<<"$S17"; then echo "  ✅ 17: EP-006 S82795 regression pipe in link text"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-006 S82795 regression FAILED"; FAIL=$((FAIL+1)); fi

echo ""
echo "=== 18. Mermaid Block (<add-ons> → \`\`\`mermaid fence) ==="
# Source: https://my.feishu.cn/wiki/GpY1wUYkbiomW1kbA1RcmwB2nId
# The pipeline converts <add-ons component-type-id="blk_631fefbbae02400430b8f9f4"> to
# a ```mermaid fence so lark-cli v1.0.6+ can upload it as a whiteboard block.
# JSON.parse inside the converter unescapes \u003e → > and \n → newline.
if grep -qF -- '```mermaid' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: mermaid code fence present"; PASS=$((PASS+1)); else echo "  ❌ 18: mermaid code fence MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Stage_1_Image_Encoder' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Stage 1 subgraph name preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Stage 1 subgraph name MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Stage_2_Sparse_Perception' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Stage 2 subgraph name preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Stage 2 subgraph name MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Ego_Init' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Ego Initialization subgraph name preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Ego Initialization subgraph name MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Stage_3_Motion_Planner' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Stage 3 subgraph name preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Stage 3 subgraph name MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'style Stage_1_Image_Encoder fill:#f7f9ff,stroke:#d6def2,stroke-width:2px,font-weight:bold' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Stage 1 container style preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Stage 1 container style MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'style Stage_2_Sparse_Perception fill:#f7f9ff,stroke:#d6def2,stroke-width:2px,font-weight:bold' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Stage 2 container style preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Stage 2 container style MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'style Ego_Init fill:#f7f9ff,stroke:#d6def2,stroke-width:2px,font-weight:bold' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Ego Initialization container style preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Ego Initialization container style MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'style Stage_3_Motion_Planner fill:#f7f9ff,stroke:#d6def2,stroke-width:2px,font-weight:bold' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Stage 3 container style preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: Stage 3 container style MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- '["**Stage 1: Image Encoder**"]' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: bold stage label preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: bold stage label MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'Training Input' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: mermaid edge label preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: mermaid edge label MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'style Img fill:#fff4df,stroke:#f4ead0,stroke-width:2px' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: start block endpoint style preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: start block endpoint style MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'style Control fill:#fff4df,stroke:#f4ead0,stroke-width:2px' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: end block endpoint style preserved"; PASS=$((PASS+1)); else echo "  ❌ 18: end block endpoint style MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- '-->' <<<"$OUTPUT_CONTENT"; then echo "  ✅ 18: Arrow --> unescaped (\\u003e decoded)"; PASS=$((PASS+1)); else echo "  ❌ 18: Arrow --> MISSING"; FAIL=$((FAIL+1)); fi
if grep -qF -- 'component-type-id="blk_631fefbbae02400430b8f9f4"' <<<"$OUTPUT_CONTENT"; then echo "  ❌ 18: <add-ons> tag not converted (still present)"; FAIL=$((FAIL+1)); else echo "  ✅ 18: <add-ons> tag replaced (not in output)"; PASS=$((PASS+1)); fi

echo ""
echo "=== 19. Callout DSL [!callout]...[/callout] Conversion ==="
# Regression: bracket DSL was not detected by hasOpeningCallout, causing injectOpeningCallout
# to extract the [!callout...] opening line as the callout description, remove it, and inject
# a new <callout emoji="bulb"> block — leaving [/callout] and the body stranded before it.
check_not "19: [!callout bracket NOT in output (converted to XML)" '[!callout'
check_not "19: [/callout] closing bracket NOT in output" '[/callout]'
check "19: rocket callout XML present" '<callout emoji="rocket"'
check "19: rocket callout body preserved" 'DSL callout body text here.'
check "19: pushpin callout XML present" '<callout emoji="pushpin"'
check "19: pushpin callout body preserved" 'Second DSL callout'

echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "========================================="

rm -f "$OUTPUT"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
