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
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
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

  let widths = repChars.map(ch => Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(ch * MAX_CHAR_WIDTH))));

  let total = widths.reduce((a, b) => a + b, 0);
  if (total < TOTAL_WIDTH) {
    const factor = TOTAL_WIDTH / total;
    widths = widths.map(w => Math.round(w * factor));
    widths[widths.indexOf(Math.max(...widths))] += TOTAL_WIDTH - widths.reduce((a, b) => a + b, 0);
  }

  return widths;
}

/**
 * Parse multi-line table rows from normalized markdown.
 * A row can span multiple lines if cell content contains newlines (e.g., from
 * </li> → \n). We collect all lines until we find one that could be the start
 * of a new row or separator.
 *
 * Strategy: look ahead from the current position. If we find a proper markdown
 * table row pattern (|header| or |---|), start of new table, or non-pipe line,
 * those are NOT part of the current cell. Everything in between is continuation.
 */
function parseTableRows(lines: string[], startIdx: number): { header: string[]; dataRows: string[][]; endIdx: number } {
  const header = parseTableRow(lines[startIdx]);
  const rows: string[][] = [];
  let j = startIdx + 2; // skip header + separator

  while (j < lines.length) {
    const line = lines[j];
    const trimmed = line.trim();

    // Skip blank lines
    if (!trimmed) { j++; continue; }

    // Check if this line starts a new table structure or non-table content
    if (!trimmed.startsWith("|")) {
      break; // End of table
    }

    // This could be a continuation of a multi-line cell if pipe count doesn't match
    // Try to parse it as a complete row first
    const parts = parseTableRow(line);
    if (parts.length === header.length) {
      // Looks like a complete row — but check if it's actually a separator
      if (SEPARATOR_RE.test(trimmed)) {
        break; // New table starts
      }
      // Check if any cell is multi-line content by looking ahead
      // A continuation line starts with | but has < cells than header
      j++;
      // Peek ahead: check if next non-blank line continues the current row
      while (j < lines.length) {
        const peek = lines[j].trim();
        if (!peek) { j++; continue; }
        const peekParts = parseTableRow(peek);
        if (peek.length === 0 || !peek.startsWith("|") || peekParts.length === header.length) {
          break; // This is NOT a continuation
        }
        // This is a continuation line — merge into current row
        for (let ci = 0; ci < Math.min(peekParts.length, parts.length); ci++) {
          // Try to append to the last cell (continuation content)
          if (ci === parts.length - 1) {
            parts[ci] += "\n" + peekParts[ci];
          } else {
            // Multi-part line — treat as cell continuation
            parts[ci] += peekParts[ci];
          }
        }
        j++;
      }
      rows.push(parts);
    } else {
      // Incomplete row — could be multi-line cell content
      // Accumulate continuation lines
      let multiLine = line;
      j++;
      while (j < lines.length) {
        const peek = lines[j].trim();
        if (!peek) { j++; continue; }
        const peekParts = parseTableRow(peek);
        // If this looks like a complete row or new content, stop accumulating
        if (peekParts.length === header.length || !peek.startsWith("|")) {
          break;
        }
        multiLine += "\n" + lines[j];
        j++;
      }
      // Parse the accumulated multi-line block as rows
      // The first part is a complete row, rest are continuations
      const fullParts = parseTableRow(multiLine.split("\n")[0]);
      // Merge continuation lines into appropriate cells
      for (const cl of multiLine.split("\n").slice(1)) {
        const clParts = parseTableRow(cl.trim());
        for (let ci = 0; ci < clParts.length && ci < header.length; ci++) {
          fullParts[ci] += "\n" + clParts[ci];
        }
      }
      if (fullParts.length === header.length) {
        rows.push(fullParts);
      }
    }
  }

  return { header, dataRows: rows, endIdx: j };
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
      SEPARATOR_RE.test(lines[i + 1]?.trim() ?? "")
    ) {
      const { header: headerCells, dataRows, endIdx } = parseTableRows(lines, i);
      i = endIdx;

      const colWidths = computeColWidths(headerCells, dataRows);
      const colCount = headerCells.length;
      const totalRows = dataRows.length + 1;

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
          const cell = ci < row.length ? row[ci] ?? "" : "";
          const cellLines = cell.trim().split("\n");
          const processed = cellLines.map(c => c.replace(/^\s+/, "")).join("\n");

          if (processed.trim() === "") {
            result.push("    <lark-td>");
            result.push("    </lark-td>");
          } else {
            result.push("    <lark-td>");
            const subLines = processed.split("\n");
            for (const sl of subLines) {
              const trimmed = sl.trim();
              if (trimmed) result.push(`      ${trimmed}`);
            }
            result.push("    </lark-td>");
          }
        }
        result.push("  </lark-tr>");
      }

      result.push("</lark-table>");
      result.push("");
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
