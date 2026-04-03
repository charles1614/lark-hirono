/**
 * Convert markdown tables to lark-table format.
 * This preserves newlines and list markers inside table cells.
 */

const TABLE_ROW_RE = /^\|(.+)\|\s*$/;
const SEPARATOR_RE = /^\|[\s:]*-+[\s:]*\|/;
const TOTAL_WIDTH = 820;
const MIN_COL_WIDTH = 80;
const MAX_COL_WIDTH = 600;
const MAX_CHAR_WIDTH = 2;

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

/** Check if a line is a markdown table separator */
function isSeparator(line: string): boolean {
  const t = line.trim();
  return SEPARATOR_RE.test(t) && !/[a-zA-Z]/.test(t.replace(/[-:| ]/g, ""));
}

/**
 * Parse multi-line table rows.
 *
 * After normalize, `</li>` → `\n` creates newlines INSIDE table cells.
 * The parser must accumulate continuation lines into the last row.
 */
function parseTableRows(lines: string[], startIdx: number): { header: string[]; dataRows: string[][]; endIdx: number } {
  const header = parseTableRow(lines[startIdx]);
  const headerLen = header.length;
  const rows: string[][] = [];
  let j = startIdx + 2; // skip header + separator

  while (j < lines.length) {
    const line = lines[j];
    const trimmed = line.trim();

    // Skip blank lines
    if (!trimmed) { j++; continue; }

    // Always stop on a new table separator
    if (isSeparator(line)) break;

    // Check if this is a potential new header (starts with | and has proper cell count)
    // and is followed by a separator → this is a NEW table, stop here
    if (trimmed.startsWith("|")) {
      const parts = parseTableRow(line);
      if (parts.length === headerLen) {
        // Could be a new row — but if the next non-blank line is a separator,
        // this is actually a new header, not a continuation
        let peek = j + 1;
        while (peek < lines.length && !lines[peek].trim()) peek++;
        if (peek < lines.length && isSeparator(lines[peek])) {
          break; // Next is separator → this line starts a new table
        }

        // Check: does this line look like a complete row without trailing `|` content?
        // A complete row ends with `|` and each pipe-delimited part is reasonable
        const cellsMatch = countPipesInCells(parts);
        if (cellsMatch) {
          // Looks like a complete data row
          rows.push(parts);
          j++;
          continue;
        }
      }
    }

    // Continuation line: belongs to the last cell of the last data row.
    // Check for heading: a line starting with # and a space, that does NOT
    // look like a table row (no pipes). This signals the end of the table.
    // We must NOT break on lines like "| #hashtag | value |" or
    // "| `#include` | note |" which are valid table rows.
    if (/^#{1,6}\s/.test(trimmed) && !trimmed.startsWith("|")) {
      break; // Table ended — standalone heading starts a new section
    }

    if (rows.length > 0) {
      let cont = trimmed;
      // Remove standalone leading/trailing | characters that come from
      // markdown table row boundaries (e.g., "| " at start, " |" at end)
      // These are artifacts of the normalize step, not real cell content
      cont = cont.replace(/^\|\s*/, "").replace(/\s*\|$/, "");
      // If cont is empty after stripping, skip it
      if (cont) {
        rows[rows.length - 1][headerLen - 1] += "\n" + cont;
      }
    }
    j++;
  }

  // Clean up each data row's last cell: remove stray trailing pipe
  for (const row of rows) {
    const lastCell = row[row.length - 1];
    row[row.length - 1] = lastCell.replace(/\s*\|$/, "");
  }

  return { header, dataRows: rows, endIdx: j };
}

/** Validate that parsed cells look like a complete table row (not continuation text). */
function countPipesInCells(cells: string[]): boolean {
  if (cells.length === 0) return false;
  // A proper row: each cell should NOT contain newline characters
  // (continuation lines accumulate text with \n into the last cell)
  // Also verify: no cell starts with "- " followed by content on the same line
  // (typical pattern for list continuation lines that get parsed as cells)
  for (const cell of cells) {
    if (cell.includes("\n")) return false;
  }
  return true;
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
          // Convert <br> to newlines and <ul>/<li> to markdown bullets
          // (native Feishu list format). \n- creates separate lines in the
          // cell — the continuation parser in parseTableRows handles them.
          let normalized = cell.replace(/<br[^>]*\/?>/gi, "\n\n");
          // Paragraph breaks in table cells: use \n\n to create empty lines
          // which Feishu markdown renders as paragraph breaks.
          normalized = normalized.replace(/<\/p>\s*<p>/gi, "\n\n");
          normalized = normalized.replace(/<\/p>/gi, "");
          normalized = normalized.replace(/<p>/gi, "");
          normalized = normalized.replace(/<li>\s*<\/li>/gi, "");
          normalized = normalized.replace(/<li>/gi, "\n- ");
          normalized = normalized.replace(/<\/li>/gi, "");
          // Add newline after closing list tags before removing them
          normalized = normalized.replace(/<\/ul>\s*/gi, "\n");
          normalized = normalized.replace(/<\/ol>\s*/gi, "\n");
          normalized = normalized.replace(/<\/?ul>/gi, "");
          normalized = normalized.replace(/<\/?ol>/gi, "");
          const processedLines = normalized.trim().split("\n").map(c => c.replace(/^\s+/, ""));

          if (processedLines.length === 0) {
            result.push("    <lark-td>");
            result.push("    </lark-td>");
          } else {
            result.push("    <lark-td>");
            for (const pl of processedLines) {
              // Preserve paragraph breaks: keep empty lines
              result.push(`      ${pl}`);
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
    if (content[i] === "<" && !inTag) {
      // Only enter inTag if there's a matching > later (real HTML tag)
      const closeIdx = content.indexOf(">", i + 1);
      if (closeIdx !== -1) { inTag = true; current += content[i]; }
      else { current += content[i]; } // bare < without >, not a tag
    }
    else if (content[i] === ">") { inTag = false; current += content[i]; }
    else if (content[i] === "|" && !inTag) {
      if (i > 0 && content[i - 1] === "\\") {
        if (i > 1 && content[i - 2] === "\\") {
          // \\| — escaped backslash + pipe separator (split here)
          current = current.slice(0, -1); // keep one backslash
          cells.push(current);
          current = "";
        } else {
          // \| — escaped pipe, keep in same cell
          current = current.slice(0, -1) + "|";
        }
      }
      else { cells.push(current); current = ""; }
    }
    else { current += content[i]; }
  }
  cells.push(current);
  return cells;
}

/**
 * Count how many `|` separators are in a line of table markdown.
 * A proper data row has exactly `colCount - 1` internal pipes.
 */
// pipeCount: unused utility — kept for future table validation if needed
// function pipeCount(line: string): number {
//   let count = 0;
//   let inTag = false;
//   const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
//   for (let i = 0; i < trimmed.length; i++) {
//     if (trimmed[i] === "<" && !inTag) {
//       if (trimmed.indexOf(">", i + 1) !== -1) inTag = true;
//     }
//     else if (trimmed[i] === ">") inTag = false;
//     else if (trimmed[i] === "|" && !inTag) {
//       // Skip escaped pipes (\|), but count \\| (escaped backslash + pipe)
//       if (i > 0 && trimmed[i - 1] === "\\") {
//         if (i > 1 && trimmed[i - 2] === "\\") { count++; } // \\| counts as separator
//         else { continue; } // \| is escaped pipe, skip
//       }
//       else { count++; }
//     }
//   }
//   return count;
// }
