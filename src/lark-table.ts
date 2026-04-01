/**
 * Convert markdown tables to lark-table format.
 * This preserves newlines and list markers inside table cells.
 */

const TABLE_ROW_RE = /^\|(.+)\|$/;
const SEPARATOR_RE = /^\|([\s:]*-+[\s:]*\|)+$/;
const TOTAL_WIDTH = 820; // target total width for compact tables
const MIN_COL_WIDTH = 80;    // minimum per column
const MAX_CHAR_WIDTH = 2;   // px per character (approx for CJK)
const MAX_TABLE_WIDTH = 1500; // absolute maximum total width
const PCTILE = 0.7;          // use P70 of cell widths to avoid outliers

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

/**
 * Smart column width computation.
 *
 * Strategy:
 * 1. For each column, use P70 (70th percentile) of cell widths instead of max.
 *    This avoids single super-long cells from blowing up the column.
 * 2. Distribute proportionally, clamped between MIN and reasonable max.
 * 3. If content is short, upscale to TOTAL_WIDTH (820).
 * 4. If content is long, exceed 820 but hard cap at MAX_TABLE_WIDTH (1500).
 */
function p70(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * PCTILE)];
}

function computeColWidths(headerCells: string[], dataRows: string[][]): number[] {
  const colCount = headerCells.length;
  if (colCount === 0) return [];

  // Gather per-column cell widths (all rows, including header)
  const colCharWidths = headerCells.map((_, ci) => {
    const headerW = cellWidth(headerCells[ci] ?? "");
    const dataWs = dataRows.map(r => cellWidth(r[ci] ?? ""));
    return [headerW, ...dataWs];
  });

  // P70 of each column avoids single super-long outlier cells
  const p70s = colCharWidths.map(w => p70(w));

  // Natural widths: P70 × px-per-char, clamped to minimum
  let widths = p70s.map(ch => Math.max(MIN_COL_WIDTH, ch * MAX_CHAR_WIDTH));

  const naturalTotal = widths.reduce((a, b) => a + b, 0);

  if (naturalTotal < TOTAL_WIDTH) {
    // Short content — expand to 820
    const slack = TOTAL_WIDTH - naturalTotal;
    if (naturalTotal === 0) {
      widths = Array(colCount).fill(Math.floor(TOTAL_WIDTH / colCount));
    } else {
      for (let i = 0; i < colCount; i++) {
        widths[i] += Math.round(slack * (widths[i] / naturalTotal));
      }
      widths[0] += TOTAL_WIDTH - widths.reduce((a, b) => a + b, 0);
    }
  } else {
    // Long content — keep proportional but cap total at MAX_TABLE_WIDTH
    if (naturalTotal > MAX_TABLE_WIDTH) {
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
