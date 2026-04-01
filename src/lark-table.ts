/**
 * Convert markdown tables to lark-table format.
 * This preserves newlines and list markers inside table cells.
 */

const TABLE_ROW_RE = /^\|(.+)\|$/;
const SEPARATOR_RE = /^\|([\s:]*-+[\s:]*\|)+$/;
const TOTAL_WIDTH = 820; // target total width for compact tables
const MIN_COL_WIDTH = 80;    // minimum per column
const MAX_TABLE_WIDTH = 1500; // absolute maximum total width
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
  // CJK chars are roughly 2x wide
  const cjk = (stripped.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  return stripped.length + cjk;
}

/** Percentile from sorted array */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor((sorted.length - 1) * p)];
}



/**
 * Smart column width computation.
 *
 * Strategy:
 * 1. P70 of cell chars per column (avoids outlier extremes, no log compression).
 * 2. Each column gets a per-char width (P70 × 2px), clamped to MIN.
 * 3. If total < 820: expand proportionally to fill 820.
 * 4. If total > 1500: cap dominant column at 40% of 1500, redistribute surplus.
 */
function computeColWidths(headerCells: string[], dataRows: string[][]): number[] {
  const colCount = headerCells.length;
  if (colCount === 0) return [];

  // Step 1: Gather cell char widths per column (header + all data rows)
  const charWidths = headerCells.map((_, ci) => {
    const headerW = cellWidth(headerCells[ci] ?? "");
    const dataWs = dataRows.map(r => cellWidth(r[ci] ?? ""));
    return [headerW, ...dataWs];
  });

  // Step 2: P70 chars per column
  const p70s = charWidths.map(w => {
    const sorted = [...w].sort((a, b) => a - b);
    return pct(sorted, 0.7);
  });

  // Step 3: Natural width = P70 × 2px, clamped to MIN
  let widths = p70s.map(ch => Math.max(MIN_COL_WIDTH, Math.round(ch * MAX_CHAR_WIDTH)));

  const naturalTotal = widths.reduce((a, b) => a + b, 0);

  if (naturalTotal < TOTAL_WIDTH) {
    // Short table: expand to 820 proportionally
    const slack = TOTAL_WIDTH - naturalTotal;
    for (let i = 0; i < colCount; i++) {
      widths[i] += Math.round(slack * (widths[i] / naturalTotal));
    }
    widths[0] += TOTAL_WIDTH - widths.reduce((a, b) => a + b, 0);
  } else if (naturalTotal > MAX_TABLE_WIDTH) {
    // Too wide: cap dominant column at 40% of 1500, redistribute surplus
    const maxCol = Math.floor(MAX_TABLE_WIDTH * 0.40);
    let capped = false;
    for (let i = 0; i < colCount; i++) {
      if (widths[i] > maxCol) {
        widths[i] = maxCol;
        capped = true;
      }
    }
    // If we capped, the total is now below 1500 — expand remaining cols
    if (capped) {
      const curTotal = widths.reduce((a, b) => a + b, 0);
      const slack = Math.min(naturalTotal, MAX_TABLE_WIDTH) - curTotal;
      if (slack > 0) {
        const headroom = widths.map((w, i) => Math.max(0, Math.round(p70s[i] * MAX_CHAR_WIDTH) - w));
        const totalHeadroom = headroom.reduce((a, b) => a + b, 0);
        if (totalHeadroom > 0) {
          for (let i = 0; i < colCount; i++) {
            if (widths[i] < maxCol) {
              widths[i] += Math.round(slack * (headroom[i] / totalHeadroom));
            }
          }
        }
        widths[0] += Math.min(naturalTotal, MAX_TABLE_WIDTH) - widths.reduce((a, b) => a + b, 0);
      }
    } else {
      // No single column exceeded 40% — scale all down
      const scale = MAX_TABLE_WIDTH / naturalTotal;
      widths = widths.map(w => Math.round(w * scale));
      widths[widths.length - 1] += MAX_TABLE_WIDTH - widths.reduce((a, b) => a + b, 0);
    }
  }

  return widths;
}

export function convertToLarkTables(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if this is a table start: header row followed by separator
    if (
      TABLE_ROW_RE.test(line.trim()) &&
      i + 1 < lines.length &&
      SEPARATOR_RE.test(lines[i + 1].trim())
    ) {
      // Parse header
      const headerCells = parseTableRow(line);

      // Collect data rows
      const dataRows: string[][] = [];
      let j = i + 2; // skip header + separator
      while (j < lines.length && TABLE_ROW_RE.test(lines[j].trim())) {
        dataRows.push(parseTableRow(lines[j]));
        j++;
      }

      // Compute proportional column widths
      const colWidths = computeColWidths(headerCells, dataRows);
      const colCount = headerCells.length;

      // Generate lark-table
      const totalRows = dataRows.length + 1; // +1 for header
      result.push(
        `<lark-table rows="${totalRows}" cols="${colCount}" header-row="true" column-widths="${colWidths.join(",")}">`
      );

      // Header row
      result.push("");
      result.push("  <lark-tr>");
      for (const cell of headerCells) {
        result.push("    <lark-td>");
        result.push(`      ${cell.trim()}`);
        result.push("    </lark-td>");
      }
      result.push("  </lark-tr>");

      // Data rows
      for (const row of dataRows) {
        result.push("");
        result.push("  <lark-tr>");
        for (let ci = 0; ci < colCount; ci++) {
          const cell = ci < row.length ? row[ci] : "";
          const cellLines = cell.trim().split("\n");
          const processed = cellLines.map(c => c.replace(/^\s+/, "")).join("\n");

          if (processed.trim() === "") {
            result.push("    <lark-td>");
            result.push("    </lark-td>");
          } else {
            result.push("    <lark-td>");
            // Check for inline bullets (un/ordered list items)
            const subLines = processed.split("\n");
            if (subLines.some(sl => /^[-*+]\s/.test(sl.trim()) || /^\d+\.\s/.test(sl.trim()))) {
              // Inline list items — each becomes a separate block for better rendering
              for (const sl of subLines) {
                const trimmed = sl.trim();
                if (trimmed) {
                  result.push(`      ${trimmed}`);
                }
              }
            } else {
              result.push(`      ${processed}`);
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
  // Remove leading and trailing pipes
  const content = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  // Split by pipe, respecting escaped pipes AND HTML tags
  const cells: string[] = [];
  let current = "";
  let inTag = false;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "<") {
      inTag = true;
      current += content[i];
    } else if (content[i] === ">") {
      inTag = false;
      current += content[i];
    } else if (content[i] === "|" && !inTag) {
      if (i > 0 && content[i - 1] === "\\") {
        current = current.slice(0, -1) + "|";
      } else {
        cells.push(current);
        current = "";
      }
    } else {
      current += content[i];
    }
  }
  cells.push(current);
  return cells;
}
