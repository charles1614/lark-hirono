/**
 * Convert markdown tables to lark-table format.
 * This preserves newlines and list markers inside table cells.
 */

const TABLE_ROW_RE = /^\|(.+)\|$/;
const SEPARATOR_RE = /^\|([\s:]*-+[\s:]*\|)+$/;
const TOTAL_WIDTH = 820; // target total width for normal tables
const MIN_COL_WIDTH = 80;    // minimum readable width per column
const MAX_COL_WIDTH = 600;   // max per-column width to avoid domination
const MAX_CHAR_WIDTH = 2;   // px per character (approx for CJK)

/**
 * Estimate visual width of a cell (strip markdown syntax, count chars).
 * CJK chars count as 2x since they take more horizontal space.
 */
function cellWidth(cell: string): number {
  const stripped = cell
    .replace(/\*\*([^*]+)\*\*/g, "$1")  // bold
    .replace(/\*([^*]+)\*/g, "$1")       // italic
    .replace(/`([^`]+)`/g, "$1")         // code
    .replace(/~~([^~]+)~~/g, "$1")       // strikethrough
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/<[^>]+>/g, "")             // HTML tags
    .replace(/\s+/g, " ")                // collapse whitespace
    .trim();
  const cjk = (stripped.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  return stripped.length + cjk;
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
}

/**
 * Compute column widths.
 *
 * Design:
 * 1. Per-column representative char count:
 *    - ≤4 rows: max (every row matters)
 *    - >4 rows: P70 (avoids outliers)
 * 2. Convert to px: chars × 2, clamped [80, 600].
 * 3. Short tables: expand to 820 proportionally.
 * 4. Long tables: scale down to 1500 total if exceeds.
 */
function computeColWidths(headerCells: string[], dataRows: string[][]): number[] {
  const colCount = headerCells.length;
  if (colCount === 0) return [];

  const colChars = headerCells.map((_, ci) => {
    const header = cellWidth(headerCells[ci] ?? "");
    const data = dataRows.map(r => cellWidth(r[ci] ?? ""));
    return [header, ...data];
  });

  const repChars = colChars.map(w => {
    if (w.length <= 4) return Math.max(...w);
    return pct(w, 0.7);
  });

  // Natural widths: [80, 600]
  let widths = repChars.map(ch => Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(ch * MAX_CHAR_WIDTH))));

  // Expand short tables to 820
  let total = widths.reduce((a, b) => a + b, 0);
  if (total < TOTAL_WIDTH) {
    const factor = TOTAL_WIDTH / total;
    widths = widths.map(w => Math.round(w * factor));
    widths[widths.indexOf(Math.max(...widths))] += TOTAL_WIDTH - widths.reduce((a, b) => a + b, 0);
  }

  return widths;
}

export function convertToLarkTables(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (
      TABLE_ROW_RE.test(line.trim()) &&
      i + 1 < lines.length &&
      SEPARATOR_RE.test(lines[i + 1].trim())
    ) {
      const headerCells = parseTableRow(line);

      const dataRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && TABLE_ROW_RE.test(lines[j].trim())) {
        dataRows.push(parseTableRow(lines[j]));
        j++;
      }

      const colWidths = computeColWidths(headerCells, dataRows);
      const colCount = headerCells.length;
      const totalRows = dataRows.length + 1;

      result.push(
        `<lark-table rows="${totalRows}" cols="${colCount}" header-row="true" column-widths="${colWidths.join(",")}">`
      );

      result.push("");
      result.push("  <lark-tr>");
      for (const cell of headerCells) {
        result.push("    <lark-td>");
        result.push(`      ${cell.trim()}`);
        result.push("    </lark-td>");
      }
      result.push("  </lark-tr>");

      for (const row of dataRows) {
        result.push("");
        result.push("  <lark-tr>");
        for (let ci = 0; ci < colCount; ci++) {
          const cell = ci < row.length ? row[ci] ?? "" : "";
          const cellLines = cell.trim().split("\n");
          const processed = cellLines.map(c => c.replace(/^\s+/, "")).join("\n");

          if (processed.trim() === "") {
            result.push("    <lark-td>");
            result.push("    </lark-td>");
          } else {
            result.push("    <lark-td>");
            const subLines = processed.split("\n");
            // Clean up any residual __BULLET__ from older source data
            for (const sl of subLines) {
              let trimmed = sl.trim();
              trimmed = trimmed.replace(/\*\*__BULLET__\*\*/g, "- ")
                .replace(/__BULLET__/g, "- ");
              if (trimmed) result.push(`      ${trimmed}`);
            }
            result.push("    </lark-td>");
          }
        }
        result.push("  </lark-tr>");
      }

      result.push("</lark-table>");
      result.push("");
      i = j;
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const content = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let inTag = false;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "<") { inTag = true; current += content[i]; }
    else if (content[i] === ">") { inTag = false; current += content[i]; }
    else if (content[i] === "|" && !inTag) {
      if (i > 0 && content[i - 1] === "\\") { current = current.slice(0, -1) + "|"; }
      else { cells.push(current); current = ""; }
    }
    else { current += content[i]; }
  }
  cells.push(current);
  return cells;
}
