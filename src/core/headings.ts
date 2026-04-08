/**
 * Heading normalization — Chinese ordinals, duplicate numbers, missing numbers.
 *
 * Runs BEFORE preprocessMarkdown (which adds blue to existing numbers).
 */

/**
 * Normalize heading numbers:
 * - Chinese ordinals (一、二、) → sequential numbers
 * - Explicit numbers → renumber to sequential (fix out-of-sequence)
 * - Duplicate numbers → fix
 * - Missing trailing dot → add
 * - No number → keep as-is
 *
 * All numbered headings (explicit or Chinese) are renumbered sequentially
 * in document order to ensure globally unique, monotonically increasing numbers.
 */
export function normalizeHeadingNumbers(md: string): string {
  const lines = md.split("\n");

  // First pass: collect all H1/H2 headings and their info
  interface HeadingInfo {
    lineIdx: number;
    hashes: string;
    content: string;
    isChineseOrdinal: boolean;
    hasExplicitNum: boolean;
    title: string;
  }

  const headings: HeadingInfo[] = [];

  // Build set of lines inside code blocks to exclude
  const inCodeBlock = new Set<number>();
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      inside = !inside;
      inCodeBlock.add(i);
    } else if (inside) {
      inCodeBlock.add(i);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (inCodeBlock.has(i)) continue;
    const hm = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!hm) continue;

    const hashes = hm[1];
    let content = hm[2];

    // Check for Chinese ordinal with optional bold markers
    // Matches: 一、Title  or  **一、Title**
    const cnMatch = content.match(
      /^(\*{0,2})([一二三四五六七八九十]+|[甲乙丙丁戊己庚辛壬癸])、\s*(.+?)(\*{0,2})$/
    );
    if (cnMatch) {
      const boldPrefix = cnMatch[1];
      const boldSuffix = cnMatch[4];
      const title = cnMatch[3];
      headings.push({
        lineIdx: i, hashes, content, isChineseOrdinal: true,
        hasExplicitNum: false, title: boldPrefix && boldSuffix ? `**${title}**` : title,
      });
      continue;
    }

    // Match any number-like prefix to detect numbered headings:
    // - "1. Title", "1 Title", "1) Title"  → simple heading
    // - "4.3 Title"                        → out-of-sequence heading (needs renumber)
    // - "1.2.3 Title"                      → multi-level heading (needs renumber)
    // Capture all leading number chars (digits, dots, parens) and treat the rest as title.
    const anyNum = content.match(/^([\d\.]+)(?:\s+)(.+)/);
    if (anyNum) {
      headings.push({
        lineIdx: i, hashes, content, isChineseOrdinal: false,
        hasExplicitNum: true, title: anyNum[2],
      });
    } else {
      headings.push({
        lineIdx: i, hashes, content, isChineseOrdinal: false,
        hasExplicitNum: false, title: content,
      });
    }
  }

  // Second pass: assign sequential numbers with hierarchy tracking
  const assignedNumbers = new Map<number, string>(); // lineIdx → assigned number
  const levelCounters: Record<number, number> = {}; // Track counters per heading level
  const lastParentNumber: Record<number, string> = {}; // Track parent numbers for sub-headings

  for (const h of headings) {
    const level = h.hashes.length;

    if (level === 1 || level === 2) {
      // H1 and H2 headings
      if (h.isChineseOrdinal || h.hasExplicitNum) {
        // Explicit numbers get renumbered sequentially
        const prevNum = levelCounters[level] || 0;
        const newNum = prevNum + 1;
        assignedNumbers.set(h.lineIdx, `${newNum}.`);
        levelCounters[level] = newNum;
        lastParentNumber[level] = `${newNum}`;
        for (let l = level + 1; l <= 6; l++) {
          levelCounters[l] = 0;
        }
      } else {
        // No number heading → pass through
        assignedNumbers.set(h.lineIdx, "");
      }
    } else if (level >= 3) {
      // H3+ headings get hierarchical numbers (e.g., 9.1, 9.2)
      const parentLevel = 2; // Parent is always H2 for now
      if (!levelCounters[level]) levelCounters[level] = 0;
      levelCounters[level]++;
      const parentNum = lastParentNumber[parentLevel] || "";
      if (parentNum) {
        assignedNumbers.set(h.lineIdx, `${parentNum}.${levelCounters[level]}`);
      } else {
        // No parent number, pass through
        assignedNumbers.set(h.lineIdx, "");
      }
    }
  }

  // Third pass: rebuild
  const headingMap = new Map<number, string>();
  for (const [lineIdx, num] of assignedNumbers) {
    headingMap.set(lineIdx, num);
  }

  let headIdx = 0;
  const out = lines.map((line, i) => {
    if (!headingMap.has(i)) return line;
    const h = headings[headIdx++];
    const num = headingMap.get(i)!;
    if (!num) return line; // no-number heading, pass through
    return `${h.hashes} ${num} ${h.title}`;
  });

  return out.join("\n");
}
