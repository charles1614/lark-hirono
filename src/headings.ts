/**
 * Heading normalization — Chinese ordinals, duplicate numbers, missing numbers.
 *
 * Runs BEFORE preprocessMarkdown (which adds blue to existing numbers).
 */

const CHINESE_NUMS: Record<string, string> = {
  "一": "1", "二": "2", "三": "3", "四": "4", "五": "5",
  "六": "6", "七": "7", "八": "8", "九": "9", "十": "10",
  "十一": "11", "十二": "12", "十三": "13", "十四": "14", "十五": "15",
  "甲": "1", "乙": "2", "丙": "3", "丁": "4", "戊": "5",
};

/**
 * Normalize heading numbers:
 * - Chinese ordinals (一、二、) → 1. 2.
 * - Duplicate numbers → fix
 * - Missing trailing dot → add
 * - No number → keep as-is
 */
export function normalizeHeadingNumbers(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let h2Num = 0;
  const seen = new Set<string>();

  for (const line of lines) {
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (!hm || !/^#{1,2}\s/.test(line)) {
      out.push(line);
      continue;
    }

    const hashes = hm[1];
    let content = hm[2];

    // Chinese ordinal: "一、Title" → assign next global number
    const cnMatch = content.match(
      /^([一二三四五六七八九十]+|[甲乙丙丁戊己庚辛壬癸])、\s*(.+)/
    );
    if (cnMatch) {
      h2Num++;
      const normalized = `${h2Num}.`;
      seen.add(normalized);
      out.push(`${hashes} ${normalized} ${cnMatch[2]}`);
      continue;
    }

    // Existing number: "1 Title" or "1. Title" or "1) Title"
    const numMatch = content.match(/^(\d+[\.\)]?)\s+(.+)/);
    if (numMatch) {
      let num = numMatch[1];
      const title = numMatch[2];

      // Normalize: "1" → "1.", "1)" → "1."
      if (!num.endsWith(".")) {
        num = num.replace(/\)$/, "") + ".";
      }

      // Fix duplicates
      if (seen.has(num)) {
        h2Num++;
        num = `${h2Num}.`;
      } else {
        seen.add(num);
        const val = parseInt(num);
        if (!isNaN(val)) h2Num = Math.max(h2Num, val);
      }

      out.push(`${hashes} ${num} ${title}`);
    } else {
      out.push(line);
    }
  }

  return out.join("\n");
}
