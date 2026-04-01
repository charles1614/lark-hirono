#!/usr/bin/env bash
# tests/comprehensive-test.sh
# Dry-run test: verify pipeline preprocessing output.
# Superset of feishu-official-capabilities coverage.
#
# Usage: bash tests/comprehensive-test.sh
#        npm test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE="$SCRIPT_DIR/fixtures/comprehensive.md"
OUTPUT="/tmp/feishu-comprehensive-test-output.md"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local pattern="$2"
  if echo "$OUTPUT_CONTENT" | grep -qE "$pattern"; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc (missing: $pattern)"
    FAIL=$((FAIL + 1))
  fi
}

check_not() {
  local desc="$1"
  local pattern="$2"
  if echo "$OUTPUT_CONTENT" | grep -qE "$pattern"; then
    echo "  ❌ $desc (should not contain: $pattern)"
    FAIL=$((FAIL + 1))
  else
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  fi
}

check_count() {
  local desc="$1"
  local pattern="$2"
  local min="$3"
  local actual
  actual=$(echo "$OUTPUT_CONTENT" | grep -cE "$pattern" || true)
  if [ "$actual" -ge "$min" ]; then
    echo "  ✅ $desc ($actual >= $min)"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc ($actual < $min)"
    FAIL=$((FAIL + 1))
  fi
}

cd "$PROJECT_DIR"

echo "Running pipeline --dry-run --no-highlight ..."
npx tsx src/pipeline.ts "$FIXTURE" "Comprehensive Test" --dry-run --no-highlight > "$OUTPUT" 2>/dev/null

OUTPUT_CONTENT=$(cat "$OUTPUT")

echo ""
echo "=== 1. Heading Matrix ==="
check "Plain heading" 'Plain headings'
check "Colored heading preserved" 'color="red"'
check "Deep heading (####)" 'Deep heading plain'
check "Heading bg patch target" 'Patch target'
check "Blue numbering" 'color="blue">'

echo ""
echo "=== 2. Inline Rich Text ==="
check "Bold" '\*\*bold\*\*'
check "Italic" '\*italic\*'
check "Inline code" '`inline code`'
check "Strikethrough" '~~strike~~'
check "Underline" '<u>underline</u>'
check "Colored text" '<text color="red">red text</text>'
check "Background text" 'background-color="light-yellow"'
check "Chinese text" '中文'
check "Links in paragraph" '\[example\]\(https://example\.com\)'
check "Bold link" '\*\*\[bold link\]'

echo ""
echo "=== 3. List Matrix ==="
check "Unordered bullets" '\- Bullet one'
check "Nested bullets" '\- Nested bullet'
check "Ordered list" '1\. First numbered'
check "Nested ordered" '1\. Nested ordered'
check "Todo open" '\- \[ \] Open item'
check "Todo completed" '\- \[x\] Completed item'

echo ""
echo "=== 4. Callout / Quote ==="
check "Blockquote" '> 📌'
check "Callout block" '<callout'
check "Callout emoji 💡" '💡'
check "Callout bg light-blue" 'light-blue'
check "Callout with bullets" 'Bullet inside callout'

echo ""
echo "=== 5. Code and Equation ==="
check "Python code block" '```python'
check "Bash code block" '```bash'
check "Inline equation" '<equation>E = mc\^2</equation>'
check "Display equation" 'a\^2 \+ b\^2'

echo ""
echo "=== 6. HTML → Markdown ==="
check_not "No <p> tags" '</?p>'
check_not "No <ul> tags" '</?ul>'
check_not "No <li> tags" '</?li>'
check_not "No <strong>" '</?strong>'
check_not "No <b>" '</?b>'
check_not "No <em>" '</?em>'
check_not "No <i>" '</?i>'
check "Links preserved" '\[documentation\]\(https://example\.com\)'
check "Bold from strong" '\*\*PyTorch\*\*'
check "Bullet items from <li>" '\- \*\*CUDA 12\+\*\*'

echo ""
echo "=== 7. Table — simple markdown (converted to lark-table) ==="
check "Alpha row preserved" 'Alpha'

echo ""
echo "=== 8. Table — strict lark-table (passthrough) ==="
check "Strict lark-table preserved" '<lark-table column-widths="120,160,540"'
check "Strict lark-table cells" 'inline-rich'

echo ""
echo "=== 9. Table — HTML sessions (converted to lark-table) ==="
check_count "Multiple lark-tables" '<lark-table' 5
check "lark-table header-row" 'header-row="true"'
check "Bold headers" '\*\*Code\*\*'
check "Cell with list (separate lines)" '\- \*\*PyTorch\*\*'
check "Cell with links" '\[documentation\]\(https://example\.com\)'

echo ""
echo "=== 10. Heading Normalization ==="
check "Chinese ordinal → 1" 'color="blue">1 </text>Chinese Ordinal First'
check "Chinese ordinal → 2" 'color="blue">2 </text>Chinese Ordinal Second'

echo ""
echo "=== 11. Misc Controls ==="
check "Grid block" '<grid'
check "Column block" '<column>'

echo ""
echo "=== 12. Edge Cases ==="
check "Escaped pipe" 'escaped pipe'
check "Long title" 'extremely long session'

echo ""
echo "=== 13. Real-World HTML In Tables ==="
check "R-001 ul-li with bold" '\- \*\*PyTorch\*\*'
check "R-002 nested p+ul" 'Intro paragraph\.'
check "R-002 ul items converted" 'Point two'
check "R-003 br line breaks" 'Second paragraph'
check "R-004 strong+b mixed" 'bold tag'
check "R-005 ul with links" '\[NVIDIA\]'
check "R-006 multi-block cell" 'Conclusion with'
check "R-007 li with code" 'import torch'
check "R-008 empty li" 'Has content'

echo ""
echo "=== 14. Highlight Tags ==="
check "Highlight tags preserved" 'red:'
check "Multiple highlight terms" 'PyTorch.*TensorFlow'

echo ""
echo "=== 15. No Residual HTML ==="
check_not "No <p>" '</?p>'
check_not "No <ul>" '</?ul>'
check_not "No <ol>" '</?ol>'
check_not "No <li>" '</?li>'
check_not "No <strong>" '<strong>'
check_not "No <b>" '<b>'
check_not "No <em>" '<em>'
check_not "No <i>" '<i>'

echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "========================================="

rm -f "$OUTPUT"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
