/**
 * Heading normalization — Chinese ordinals, duplicate numbers, missing numbers.
 *
 * Runs BEFORE preprocessMarkdown (which adds blue to existing numbers).
 */

/**
 * Normalize heading numbers:
 * - Chinese ordinals (一、二、) → 1. 2.
 * - Duplicate numbers → fix
 * - Missing trailing dot → add
 * - No number → keep as-is
 *
 * Two-pass approach: collect all headings first to detect duplicates,
 * then assign numbers so explicit user numbers take priority over
 * converted Chinese ordinals.
 */
export function normalizeHeadingNumbers(md: string): string {
  const lines = md.split("\n");

  // First pass: collect all H1/H2 headings and their info
  interface HeadingInfo {
    lineIdx: number;
    hashes: string;
    content: string;
    isChineseOrdinal: boolean;
    explicitNum: string | null; // normalized number string (e.g. "12.")
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
        explicitNum: null, title: cnMatch[2],
      });
      continue;
    }

    const numMatch = content.match(/^(\d+[\.\)]?)\s+(.+)/);
    if (numMatch) {
      let num = numMatch[1];
      if (!num.endsWith(".")) num = num.replace(/\)$/, "") + ".";
      headings.push({
        lineIdx: i, hashes, content, isChineseOrdinal: false,
        explicitNum: num, title: numMatch[2],
      });
    } else {
      headings.push({
        lineIdx: i, hashes, content, isChineseOrdinal: false,
        explicitNum: null, title: content,
      });
    }
  }

  // Build set of all explicit user-provided numbers
  const userNumbers = new Set<string>();
  for (const h of headings) {
    if (h.explicitNum) userNumbers.add(h.explicitNum);
  }

  // Deduplicate explicit numbers: first occurrence wins, later ones get reassigned
  const seen = new Set<string>();
  const assignedNumbers = new Map<number, string>(); // lineIdx → assigned number

  let h2Num = 0;
  for (const h of headings) {
    if (h.explicitNum) {
      if (seen.has(h.explicitNum)) {
        // Duplicate user number → reassign
        h2Num++;
        assignedNumbers.set(h.lineIdx, `${h2Num}.`);
      } else {
        seen.add(h.explicitNum);
        const val = parseInt(h.explicitNum);
        if (!isNaN(val)) h2Num = Math.max(h2Num, val);
        assignedNumbers.set(h.lineIdx, h.explicitNum);
      }
    } else if (h.isChineseOrdinal) {
      // Chinese ordinal: assign next sequential number, avoid conflicts with user numbers
      do {
        h2Num++;
      } while (userNumbers.has(`${h2Num}.`));
      assignedNumbers.set(h.lineIdx, `${h2Num}.`);
    } else {
      // No number heading → pass through
      assignedNumbers.set(h.lineIdx, "");
    }
  }

  // Second pass: rebuild
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
