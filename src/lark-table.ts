/**
 * Convert markdown tables to lark-table format.
 * This preserves newlines and list markers inside table cells.
 */

const TABLE_ROW_RE = /^\|(.+)\|$/;
const SEPARATOR_RE = /^\|([\s:]*-+[\s:]*\|)+$/;

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
      const colWidths = headerCells.map(() => 104);
      const colCount = headerCells.length;

      // Collect data rows
      const dataRows: string[][] = [];
      let j = i + 2; // skip header + separator
      while (j < lines.length && TABLE_ROW_RE.test(lines[j].trim())) {
        dataRows.push(parseTableRow(lines[j]));
        j++;
      }

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
