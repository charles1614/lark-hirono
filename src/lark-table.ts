/**
 * Convert markdown tables to lark-table format.
 * This preserves newlines and list markers inside table cells.
 */

const TABLE_ROW_RE = /^\|(.+)\|$/;
const SEPARATOR_RE = /^\|([\s:]*-+[\s:]*\|)+$/;
const TOTAL_WIDTH = 820; // default total width
const MIN_COL_WIDTH = 80;     // minimum per column
const MAX_CHAR_WIDTH = 2;      // px per character (approx for CJK)
const MAX_TABLE_WIDTH = 2000;  // absolute maximum total width

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
 * Compute column widths proportional to actual content.
 * - Short content: expand to 820 total
 * - Long content: exceed 820 to avoid truncation
 */
function computeColWidths(headerCells: string[], dataRows: string[][]): number[] {
  const colCount = headerCells.length;
  if (colCount === 0) return [];

  // Max char width per column (header + all data cells)
  const maxChars = headerCells.map((h, ci) => {
    const headerW = cellWidth(h);
    const dataW = Math.max(0, ...dataRows.map(r => cellWidth(r[ci] ?? "")));
    return Math.max(headerW, dataW);
  });

  // Natural widths: chars × px-per-char, clamped to minimum
  let widths = maxChars.map(chars => Math.max(MIN_COL_WIDTH, chars * MAX_CHAR_WIDTH));

  const naturalTotal = widths.reduce((a, b) => a + b, 0);

  // Expand to TOTAL_WIDTH if content is short
  if (naturalTotal < TOTAL_WIDTH) {
    const slack = TOTAL_WIDTH - naturalTotal;
    if (naturalTotal === 0) {
      // All empty — equal width
      widths = Array(colCount).fill(Math.floor(TOTAL_WIDTH / colCount));
    } else {
      // Fill slack proportionally
      for (let i = 0; i < colCount; i++) {
        widths[i] += Math.round(slack * (widths[i] / naturalTotal));
      }
      // Fix rounding
      widths[0] += TOTAL_WIDTH - widths.reduce((a, b) => a + b, 0);
    }
  }
  // If naturalTotal >= TOTAL_WIDTH, keep actual widths (expand beyond 820)
  // But cap at MAX_TABLE_WIDTH
  const afterExpand = widths.reduce((a, b) => a + b, 0);
  if (afterExpand > MAX_TABLE_WIDTH) {
    const scale = MAX_TABLE_WIDTH / afterExpand;
    widths = widths.map(w => Math.round(w * scale));
    widths[widths.length - 1] += MAX_TABLE_WIDTH - widths.reduce((a, b) => a + b, 0);
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
        result.push("  <lark-tr>");
        for (const cell of row) {
          result.push("    <lark-td>");
          // Convert {red:**text**} → <text color="red">**text**</text>
          let processed = cell.replace(
            /\{(\w+):\*\*([^*]+)\*\*\}/g,
            '<text color="$1">**$2**</text>'
          );
          // Convert <br> to newlines (safe inside lark-table cells)
          processed = processed.replace(/<br\s*\/?>/gi, "\n");
          // Convert bullet placeholder to newline + dash (safe inside cells)
          processed = processed.replace(/\s*__BULLET__\s*/g, "\n- ");
          // Fix: Feishu lark-table parser drops cells ending with </text>
          // Append zero-width space (\u200B) to prevent content loss
          if (processed.trimEnd().endsWith('</text>')) {
            processed = processed.trimEnd() + '\u200B';
          }
          // Preserve newlines inside cells
          const cellLines = processed.split("\n");
          for (const cl of cellLines) {
            result.push(`      ${cl.trim()}`);
          }
          result.push("    </lark-td>");
        }
        result.push("  </lark-tr>");
      }

      result.push("</lark-table>");
      result.push("");

      i = j; // advance past all table rows
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
    } else if (content[i] === "|" && !inTag && (i === 0 || content[i - 1] !== "\\")) {
      cells.push(current);
      current = "";
    } else {
      current += content[i];
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}
