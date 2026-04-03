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

check() {
  local desc="$1"; local pattern="$2"
  if echo "$OUTPUT_CONTENT" | grep -qF "$pattern"; then
    echo "  ✅ $desc"; PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"; FAIL=$((FAIL + 1))
  fi
}

check_regex() {
  local desc="$1"; local pattern="$2"
  if echo "$OUTPUT_CONTENT" | grep -qE "$pattern"; then
    echo "  ✅ $desc"; PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"; FAIL=$((FAIL + 1))
  fi
}

check_not() {
  local desc="$1"; local pattern="$2"
  if echo "$OUTPUT_CONTENT" | grep -qF "$pattern"; then
    echo "  ❌ $desc (should not contain: $pattern)"; FAIL=$((FAIL + 1))
  else
    echo "  ✅ $desc"; PASS=$((PASS + 1))
  fi
}

check_count() {
  local desc="$1"; local pattern="$2"; local min="$3"
  local actual; actual=$(echo "$OUTPUT_CONTENT" | grep -cF "$pattern" || true)
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
npx tsx src/pipeline.ts "$FIXTURE" "Comprehensive Test" --dry-run --no-highlight > "$OUTPUT" 2>/dev/null
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
check "Inline equation" '<equation>E = mc'

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
if echo "$S7" | grep -qF 'rows="4"'; then echo "  ✅ Section 7 table rows=4"; PASS=$((PASS+1)); else echo "  ❌ Section 7 rows"; FAIL=$((FAIL+1)); fi
check "Alpha row preserved" 'Alpha'

echo ""
echo "=== 8. Table — strict lark-table ==="
S8=$(section_content 'color="blue">8 ' 'color="blue">9 ')
check "Strict table cells" 'inline-rich'
check "Ordered list in cell" 'first'

echo ""
echo "=== 9. Table — HTML sessions ==="
S9=$(section_content 'color="blue">9 ' 'color="blue">10 ')
if echo "$S9" | grep -qF 'rows="11"'; then echo "  ✅ Section 9 rows=11"; PASS=$((PASS+1)); else echo "  ❌ Section 9 rows WRONG"; FAIL=$((FAIL+1)); fi
if echo "$S9" | grep -qF 'cols="3"'; then echo "  ✅ Section 9 cols=3"; PASS=$((PASS+1)); else echo "  ❌ Section 9 cols"; FAIL=$((FAIL+1)); fi
for code in 001 002 003 004 005 006 007 008 009 010; do
  if echo "$S9" | grep -qF "HTML-$code"; then echo "  ✅ HTML-$code in table"; PASS=$((PASS+1)); else echo "  ❌ HTML-$code MISSING"; FAIL=$((FAIL+1)); fi
done
check "<li> → bullet in cell" 'PyTorch'
check "Links in cell" '[documentation](https://example.com)'

echo ""
echo "=== 10. Table — Rich Text Sessions ==="
S10=$(section_content 'color="blue">10 ' 'color="blue">11 ')
if echo "$S10" | grep -qF 'rows="11"'; then echo "  ✅ Section 10 rows=11"; PASS=$((PASS+1)); else echo "  ❌ Section 10 rows"; FAIL=$((FAIL+1)); fi
for code in RT-001 RT-002 RT-003 RT-004 RT-005 RT-006 RT-007 RT-008 RT-009 RT-010; do
  if echo "$S10" | grep -qF "$code"; then echo "  ✅ $code in table"; PASS=$((PASS+1)); else echo "  ❌ $code MISSING"; FAIL=$((FAIL+1)); fi
done

echo ""
echo "=== 11. Heading Normalization ==="
S11=$(section_content 'color="blue">11 ' 'color="blue">12 ')
if echo "$S11" | grep -qF 'color="blue">18 </text>Chinese Ordinal First'; then echo "  ✅ Chinese → 18"; PASS=$((PASS+1)); else echo "  ❌ Chinese → 18"; FAIL=$((FAIL+1)); fi
if echo "$S11" | grep -qF 'color="blue">19 </text>Chinese Ordinal Second'; then echo "  ✅ Chinese → 19"; PASS=$((PASS+1)); else echo "  ❌ Chinese → 19"; FAIL=$((FAIL+1)); fi

echo ""
echo "=== 12. Misc Controls ==="
check "Grid block" '<grid'
check "Column block" '<column>'

echo ""
echo "=== 13. Edge Cases ==="
check "Escaped pipe" 'escaped pipe'
check "Long title" 'extremely long session'

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
if echo "$S16" | grep -qF 'First paragraph'; then echo "  ✅ 16: P-001 first paragraph preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-001 first paragraph MISSING"; FAIL=$((FAIL+1)); fi
if echo "$S16" | grep -qF 'Second paragraph'; then echo "  ✅ 16: P-001 second paragraph preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-001 second paragraph MISSING"; FAIL=$((FAIL+1)); fi
if echo "$S16" | grep -qF 'Main abstract text'; then echo "  ✅ 16: P-004 abstract text preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-004 abstract text MISSING"; FAIL=$((FAIL+1)); fi
if echo "$S16" | grep -qF '**Important:**'; then echo "  ✅ 16: P-004 Important bold preserved"; PASS=$((PASS+1)); else echo "  ❌ 16: P-004 Important bold MISSING"; FAIL=$((FAIL+1)); fi
# P-001: two paragraphs should be on separate lines (not space-joined)
# With empty line separator: grep -A2 catches it
if echo "$S16" | grep -A2 'First paragraph' | grep -q 'Second paragraph'; then echo "  ✅ 16: P-001 paragraphs on separate lines"; PASS=$((PASS+1)); else echo "  ❌ 16: P-001 paragraphs NOT on separate lines"; FAIL=$((FAIL+1)); fi

echo ""
echo "=== 17. Escaped Pipe in Cells (regression) ==="
S17=$(section_content 'color="blue">17 ' 'color="blue">15 ')
if echo "$S17" | grep -qF 'rows="7"'; then echo "  ✅ 17: Section 17 rows=7"; PASS=$((PASS+1)); else echo "  ❌ 17: Section 17 rows WRONG"; FAIL=$((FAIL+1)); fi
if echo "$S17" | grep -qF 'cols="3"'; then echo "  ✅ 17: Section 17 cols=3"; PASS=$((PASS+1)); else echo "  ❌ 17: Section 17 cols WRONG"; FAIL=$((FAIL+1)); fi
for code in EP-001 EP-002 EP-003 EP-004 EP-005 EP-006; do
  if echo "$S17" | grep -qF "$code"; then echo "  ✅ 17: $code in table"; PASS=$((PASS+1)); else echo "  ❌ 17: $code MISSING"; FAIL=$((FAIL+1)); fi
done
if echo "$S17" | grep -qF 'Install Guide | Notice'; then echo "  ✅ 17: EP-001 escaped pipe in link preserved"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-001 escaped pipe broken"; FAIL=$((FAIL+1)); fi
if echo "$S17" | grep -qF 'pipe in cell'; then echo "  ✅ 17: EP-005 escaped pipe preserved in cell"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-005 escaped pipe broken"; FAIL=$((FAIL+1)); fi
if echo "$S17" | grep -qF 'grep | sort | uniq'; then echo "  ✅ 17: EP-002 escaped pipes in code preserved"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-002 escaped pipes broken"; FAIL=$((FAIL+1)); fi
if echo "$S17" | grep -qF 'Install & Demo Guide | Notice & Disclaimers'; then echo "  ✅ 17: EP-006 S82795 regression pipe in link text"; PASS=$((PASS+1)); else echo "  ❌ 17: EP-006 S82795 regression FAILED"; FAIL=$((FAIL+1)); fi

echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "========================================="

rm -f "$OUTPUT"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
