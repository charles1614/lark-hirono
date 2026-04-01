#!/usr/bin/env bash
# tests/upload-test.sh
# Upload comprehensive.md to Feishu, verify read-back, then delete.
#
# Usage: bash tests/upload-test.sh
#        npm run test:upload
#
# Requires: lark-cli auth (lark-cli auth login --domain docs)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE="$SCRIPT_DIR/fixtures/comprehensive.md"
WIKI_SPACE="7620053427331681234"
WIKI_NODE="UNtHwabqNiqc8ZkzvLscWNnwnYd"
LARKCLI="/tmp/openclaw/larkcli/node_modules/.bin/lark-cli"

PASS=0
FAIL=0
DOC_ID=""
DOC_URL=""

cleanup() {
  if [ -n "$DOC_ID" ]; then
    echo ""
    echo "Test doc: $DOC_URL"
    echo "(auto-delete skipped — clean up manually if needed)"
  fi
}
trap cleanup EXIT

check() {
  local desc="$1"
  local pattern="$2"
  if echo "$READBACK" | grep -qE "$pattern"; then
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
  if echo "$READBACK" | grep -qE "$pattern"; then
    echo "  ❌ $desc (should not contain: $pattern)"
    FAIL=$((FAIL + 1))
  else
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  fi
}

cd "$PROJECT_DIR"

echo "=== Phase 1: Upload ==="
echo "Running pipeline with --verify ..."

UPLOAD_OUTPUT=$(npx tsx src/pipeline.ts "$FIXTURE" "Comprehensive Test Upload" \
  --wiki-space "$WIKI_SPACE" \
  --wiki-node "$WIKI_NODE" \
  --no-highlight \
  --verify \
  2>&1)

echo "$UPLOAD_OUTPUT" | grep -E "^(Title|Done|Doc ready|Blocks|Patches|Verified|Status)" || true

# Extract doc URL and wiki node from output
DOC_URL=$(echo "$UPLOAD_OUTPUT" | grep -oP 'URL: https://[^\s]+' | tail -1 | sed 's/URL: //')
DOC_ID=$(echo "$DOC_URL" | grep -oP 'wiki/\K[a-zA-Z0-9]+' || true)

if [ -z "$DOC_ID" ]; then
  echo "❌ Could not extract doc ID from output"
  echo "$UPLOAD_OUTPUT"
  exit 1
fi

echo "Wiki node: $DOC_ID"
echo "URL: $DOC_URL"
echo ""

echo "=== Phase 2: Read-back ==="

# Get doc_token from wiki node
DOC_TOKEN=$("$LARKCLI" api GET "/open-apis/wiki/v2/spaces/$WIKI_SPACE/nodes/$DOC_ID" 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('node',{}).get('obj_token',''))" 2>/dev/null || echo "")

if [ -z "$DOC_TOKEN" ]; then
  echo "❌ Failed to get doc_token"
  exit 1
fi

echo "Doc token: $DOC_TOKEN"

READBACK=$("$LARKCLI" docs +fetch --doc "$DOC_TOKEN" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('data', {}).get('markdown', ''))
" 2>/dev/null || echo "")

if [ -z "$READBACK" ]; then
  echo "❌ Failed to read back document"
  exit 1
fi

echo "Lines: $(echo "$READBACK" | wc -l)"
echo ""

echo "=== Structure ==="
check "Section headings" '## '
check "lark-table blocks" '<lark-table'

echo ""
echo "=== HTML → Markdown ==="
check_not "No <p> tags" '</?p>'
check_not "No <ul> tags" '</?ul>'
check_not "No <li> tags" '</?li>'
check "Links preserved" '\[.*\]\(https?://'
check "Bold preserved" '\*\*.*\*\*'

echo ""
echo "=== Table Content ==="
check "Code column" '\*\*Code\*\*|Code'
check "Title column" '\*\*Title\*\*|Title'
check "HTML-001 code" 'HTML-001'
check "HTML-003 code" 'HTML-003'
check "Bullet items" '\- \*\*PyTorch\*\*'
check "Links in cells" '\[documentation\]\(https://example\.com\)'
check "Chinese text" '中文'

echo ""
echo "=== Heading Numbers ==="
check "Blue-numbered heading" 'color="blue"'
check "Chinese ordinal" 'Chinese Ordinal'

echo ""
echo "=== Block Count ==="
BLOCKS=$("$LARKCLI" api GET "/open-apis/docx/v1/documents/$DOC_TOKEN/blocks?page_size=500" 2>&1 | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',{}).get('items',[])))" 2>/dev/null || echo "0")
echo "  Blocks: $BLOCKS"
if [ "${BLOCKS:-0}" -gt 20 ]; then
  echo "  ✅ Block count ($BLOCKS)"
  PASS=$((PASS + 1))
else
  echo "  ❌ Too few blocks ($BLOCKS)"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "Doc: $DOC_URL"
echo "========================================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
