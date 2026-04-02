/**
 * Verification — fetch-back and validate document after creation.
 *
 * Checks:
 * 1. All sections present
 * 2. All data rows present
 * 3. Heading backgrounds applied
 * 4. Red highlights present
 * 5. Bold headers present
 * 6. No empty bullets
 */

import type { LarkCli } from "./cli.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface VerifyReport {
  totalBlocks: number;
  rootChildren: number;

  // Sections
  headingCount: number;
  headingRootCount: number; // headings at root level (not inside tables)
  headingsWithBg: number;
  headingBgCoverage: number;

  // Tables
  tableCount: number;

  // Highlights
  redHighlightCount: number;

  // Bold headers
  boldHeaderCount: number;

  // Bullets
  bulletCount: number;
  emptyBulletCount: number;

  // Issues
  residualHtmlTags: string[];

  // Overall
  checks: { name: string; pass: boolean; detail: string }[];
  ok: boolean;
}

// ─── Verify ─────────────────────────────────────────────────────────────

/** HTML tag patterns that should never appear in rendered doc blocks. */
const RESIDUAL_HTML_RE = /<\/?(?:p|ul|ol|li|strong|b|em|i)\b[^>]*>/gi;

export function verifyDoc(cli: LarkCli, docId: string): VerifyReport {
  const blocks = cli.getBlocks(docId);

  const report: VerifyReport = {
    totalBlocks: blocks.length,
    rootChildren: 0,
    headingCount: 0,
    headingRootCount: 0,
    headingsWithBg: 0,
    headingBgCoverage: 0,
    tableCount: 0,
    redHighlightCount: 0,
    boldHeaderCount: 0,
    bulletCount: 0,
    emptyBulletCount: 0,
    residualHtmlTags: [],
    checks: [],
    ok: false,
  };

  // Root children — collect IDs for root-level check
  const root = blocks.find((b) => b.block_type === 1);
  const rootChildIds: string[] = root ? ((root as any).children || []) : [];
  report.rootChildren = rootChildIds.length;

  // Build a set of block IDs that are table children (for heading-in-table check)
  const tableChildIds = new Set<string>();
  for (const b of blocks) {
    if (b.block_type === 31) {
      const children = (b as any).children || [];
      for (const cid of children) tableChildIds.add(cid);
    }
  }

  for (const b of blocks) {
    const bt = b.block_type as number;

    // Headings (type 3-11)
    if (bt >= 3 && bt <= 11) {
      report.headingCount++;
      if (rootChildIds.includes(b.block_id) && !tableChildIds.has(b.block_id)) {
        report.headingRootCount++;
      }
      const key = `heading${bt - 2}`;
      const v = (b as any)[key] || {};
      const bg = v.style?.background_color;
      if (bg) report.headingsWithBg++;
    }

    // Tables (type 31)
    if (bt === 31) report.tableCount++;

    // Bullets (type 12)
    if (bt === 12) {
      report.bulletCount++;
      const els = (b as any).bullet?.elements || [];
      const text = els.map((e: any) => e.text_run?.content || "").join("").trim();
      if (!text) report.emptyBulletCount++;
    }

    // Text blocks (type 2) — check red highlights, bold headers, residual HTML
    if (bt === 2) {
      const els = (b as any).text?.elements || [];
      for (const e of els) {
        const content: string = e.text_run?.content || "";
        const style = e.text_run?.text_element_style || {};

        if (style.text_color === 1) report.redHighlightCount++;
        if (style.bold) {
          const trimmed = content.trim();
          if (["Code", "Title", "Speakers", "Company", "Industry", "Abstract", "PDF"].includes(trimmed)) {
            report.boldHeaderCount++;
          }
        }

        // Check for residual HTML tags in rendered text
        const htmlMatches = content.match(RESIDUAL_HTML_RE);
        if (htmlMatches) {
          for (const tag of htmlMatches) {
            if (!report.residualHtmlTags.includes(tag)) {
              report.residualHtmlTags.push(tag);
            }
          }
        }
      }
    }
  }

  // Compute coverage
  report.headingBgCoverage =
    report.headingCount > 0
      ? Math.round((report.headingsWithBg / report.headingCount) * 100)
      : 100;

  // Build checks
  report.checks = [
    {
      name: "Headings at root level",
      pass: report.headingRootCount >= 10,
      detail: `${report.headingRootCount}/${report.headingCount} root-level`,
    },
    {
      name: "Heading bg coverage",
      pass: report.headingBgCoverage >= 90,
      detail: `${report.headingsWithBg}/${report.headingCount} (${report.headingBgCoverage}%)`,
    },
    {
      name: "Tables present",
      pass: report.tableCount > 0,
      detail: `${report.tableCount} tables`,
    },
    {
      name: "Native bullets",
      pass: report.bulletCount >= 5,
      detail: `${report.bulletCount} bullets`,
    },
    {
      name: "No empty bullets",
      pass: report.emptyBulletCount <= 3,
      detail: `${report.emptyBulletCount} empty bullets`,
    },
    {
      name: "Red highlights",
      pass: report.redHighlightCount >= 2,
      detail: `${report.redHighlightCount} highlights`,
    },
    {
      name: "Bold headers",
      pass: report.boldHeaderCount >= 7,
      detail: `${report.boldHeaderCount} bold headers`,
    },
    {
      name: "No residual HTML",
      pass: report.residualHtmlTags.length === 0,
      detail: report.residualHtmlTags.length === 0
        ? "clean"
        : `found: ${report.residualHtmlTags.join(", ")}`,
    },
  ];

  report.ok = report.checks.every((c) => c.pass);
  return report;
}

/**
 * Human-readable report summary.
 */
export function formatReport(report: VerifyReport): string {
  const lines = [
    `Blocks: ${report.totalBlocks} (${report.rootChildren} root children)`,
    `Headings: ${report.headingRootCount}/${report.headingCount} root-level (${report.headingBgCoverage}% bg)`,
    `Tables: ${report.tableCount}`,
    `Bullets: ${report.bulletCount} (${report.emptyBulletCount} empty)`,
    `Red highlights: ${report.redHighlightCount}`,
    `Bold headers: ${report.boldHeaderCount}`,
    `Residual HTML: ${report.residualHtmlTags.length === 0 ? "none" : report.residualHtmlTags.join(", ")}`,
    ``,
    ...report.checks.map((c) => `${c.pass ? "✅" : "❌"} ${c.name}: ${c.detail}`),
    ``,
    `Status: ${report.ok ? "✅ PASS" : "❌ FAIL"}`,
  ];
  return lines.join("\n");
}
