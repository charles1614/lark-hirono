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

  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!hm || !/^#{1,2}\s/.test(lines[i])) continue;

    const hashes = hm[1];
    let content = hm[2];

    const cnMatch = content.match(
      /^([一二三四五六七八九十]+|[甲乙丙丁戊己庚辛壬癸])、\s*(.+)/
    );
    if (cnMatch) {
      headings.push({
        lineIdx: i, hashes, content, isChineseOrdinal: true,
        hasExplicitNum: false, title: cnMatch[2],
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

  // Second pass: assign sequential numbers
  const assignedNumbers = new Map<number, string>(); // lineIdx → assigned number
  let h2Num = 0;

  for (const h of headings) {
    if (h.hasExplicitNum || h.isChineseOrdinal) {
      // Both explicit numbers and Chinese ordinals get sequential numbering
      h2Num++;
      assignedNumbers.set(h.lineIdx, `${h2Num}.`);
    } else {
      // No number heading → pass through
      assignedNumbers.set(h.lineIdx, "");
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
