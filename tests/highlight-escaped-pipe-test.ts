/**
 * Test: highlightApply preserves escaped pipes in table cells.
 * Regression test for: S82795 row with \| in link text causing column shift.
 */

import { highlightApply } from "../src/highlight.js";

// Create test fixture with escaped pipe in title column
const fixture = `# Test Catalog

| Code | Title | Speakers | Abstract |
|------|-------|----------|----------|
| T-001 | Normal title | Alice | Normal abstract text |
| T-002 | Title with \\| pipe | Bob | Abstract with [link \\| text](https://example.com) |
| T-003 | Another \\| pipe title | Carol | More \\| escaped \\| pipes |
`;

// Keywords that will trigger highlight on T-002
const keywords = [
  { code: "T-001", keyword: "Normal" },
  { code: "T-002", keyword: "pipe" },
  { code: "T-003", keyword: "Another" },
];

console.log("=== Test: highlightApply preserves escaped pipes ===\n");

// Run highlight apply
const { markdown: output } = highlightApply(fixture, keywords);

function unescapedPipeCount(row: string): number {
  let count = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "|" && (i === 0 || row[i - 1] !== "\\")) count++;
  }
  return count;
}

function hasEscapedPipe(row: string): boolean {
  return row.includes("\\|");
}

const lines = output.split("\n");

// Check 1: T-002 row — 5 unescaped pipes (cell boundaries), not 6+ (which would mean extra column split)
const t002Row = lines.find((l) => l.includes("T-002")) || "";
const t002UPCount = unescapedPipeCount(t002Row);

if (t002UPCount === 5) {
  console.log("✅ T-002 row has correct unescaped pipe count (5)");
} else {
  console.log("❌ T-002 row has wrong unescaped pipe count:", t002UPCount, "(expected 5)");
  console.log("   Row:", t002Row);
  process.exit(1);
}

// Check 2: Escaped pipe is preserved in the row
if (hasEscapedPipe(t002Row)) {
  console.log("✅ T-002 row preserves escaped pipe");
} else {
  console.log("❌ T-002 row lost escaped pipe");
  console.log("   Row:", t002Row);
  process.exit(1);
}

// Check 3: Link text preserves pipe as escaped pipe in output
if (output.includes("link \\| text")) {
  console.log("✅ Link text preserves escaped pipe after highlight");
} else {
  console.log("❌ Link text lost pipe");
  console.log("   Output snippet:", output.split("\n").find((l) => l.includes("link"))?.slice(0, 80));
  process.exit(1);
}

// Check 4: T-003 also preserves escaped pipes
const t003Row = lines.find((l) => l.includes("T-003")) || "";
const t003UPCount = unescapedPipeCount(t003Row);

if (t003UPCount === 5) {
  console.log("✅ T-003 row has correct unescaped pipe count (5)");
} else {
  console.log("❌ T-003 row has wrong unescaped pipe count:", t003UPCount, "(expected 5)");
  console.log("   Row:", t003Row);
  process.exit(1);
}

// Check 5: T-001 (no escaped pipes) is unchanged
const t001Row = lines.find((l) => l.includes("T-001")) || "";
const t001UPCount = unescapedPipeCount(t001Row);

if (t001UPCount === 5) {
  console.log("✅ T-001 row has correct unescaped pipe count (5)");
} else {
  console.log("❌ T-001 row has wrong unescaped pipe count:", t001UPCount, "(expected 5)");
  console.log("   Row:", t001Row);
  process.exit(1);
}

console.log("\n=== All tests passed ===\n");
