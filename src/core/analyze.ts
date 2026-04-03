/**
 * Markdown analyzer — classify document type and suggest optimization modules.
 *
 * Ported from feishu_tool.py analyze_markdown_for_feishu.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type DocumentType = "narrative" | "data_table" | "catalog_table" | "mixed";

export interface AnalysisReport {
  documentType: DocumentType;
  headingCount: number;
  calloutCount: number;
  hasTables: boolean;
  tableCount: number;
  tableRows: number;
  titleHighlightCandidate: boolean;
  categoryColumns: string[];
  riskFlags: string[];
  suggestedModules: string[];
}

// ─── Analyze ────────────────────────────────────────────────────────────

export function analyzeMarkdown(mdText: string): AnalysisReport {
  const lines = mdText.split("\n");
  const report: AnalysisReport = {
    documentType: "mixed",
    headingCount: 0,
    calloutCount: 0,
    hasTables: false,
    tableCount: 0,
    tableRows: 0,
    titleHighlightCandidate: false,
    categoryColumns: [],
    riskFlags: [],
    suggestedModules: [],
  };

  report.headingCount = lines.filter((l) => l.trimStart().startsWith("#")).length;
  report.calloutCount = lines.filter((l) =>
    l.trimStart().startsWith("> [!callout")
  ).length;
  report.hasTables = lines.some((l) => l.trim().startsWith("|"));

  let inTable = false;
  let pendingHeader: string[] | null = null;

  for (const line of lines) {
    const s = line.trim();

    // Header row detection
    if (s.startsWith("|") && s.includes("**") && s.split("|").length >= 3 && !s.includes("---")) {
      pendingHeader = s
        .split("|")
        .map((c) => c.trim().replace(/\*/g, ""))
        .filter(Boolean);
      if (inTable) report.tableRows++;
      continue;
    }

    // Separator row = start of table
    if (s.startsWith("|") && s.includes("---")) {
      inTable = true;
      report.tableCount++;

      if (pendingHeader) {
        const lower = pendingHeader.map((c) => c.toLowerCase());
        if (lower.some((c) => c === "title" || c === "name")) {
          report.titleHighlightCandidate = true;
        }
        for (const c of pendingHeader) {
          const cl = c.toLowerCase();
          if (["industry", "type", "tag", "category", "topic", "language"].includes(cl)) {
            if (!report.categoryColumns.includes(c)) {
              report.categoryColumns.push(c);
            }
          }
        }
      }
      continue;
    }

    // Data row
    if (inTable && s.startsWith("|")) {
      report.tableRows++;
      continue;
    }

    // End of table
    if (inTable && !s.startsWith("|")) {
      inTable = false;
      pendingHeader = null;
    }
  }

  // Document type classification
  if (report.hasTables && report.tableRows >= 50) {
    report.documentType = "catalog_table";
  } else if (report.hasTables && report.tableRows > 0) {
    report.documentType = "data_table";
  } else if (report.headingCount >= 3) {
    report.documentType = "narrative";
  } else {
    report.documentType = "mixed";
  }

  // Risk flags
  if (/^\|.*\\\|.*\|/m.test(mdText)) {
    report.riskFlags.push("escaped-pipe-in-table-cell");
  }
  if (/<[^>]+>/.test(mdText)) {
    report.riskFlags.push("html-present");
  }
  if (/\{red:\*\*\{red:/.test(mdText)) {
    report.riskFlags.push("nested-red-tags");
  }

  // Suggested modules
  if (["catalog_table", "data_table"].includes(report.documentType)) {
    report.suggestedModules.push("table_safety", "category_color");
    if (report.calloutCount === 0) {
      report.suggestedModules.push("opening_callout");
    }
    if (report.titleHighlightCandidate && report.documentType === "catalog_table") {
      report.suggestedModules.push("title_highlight");
    }
  } else if (report.documentType === "narrative") {
    if (report.calloutCount === 0) {
      report.suggestedModules.push("opening_callout");
    }
    if (report.headingCount >= 3) {
      report.suggestedModules.push("heading_numbering");
    }
  }

  return report;
}
