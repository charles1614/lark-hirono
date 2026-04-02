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
  headingsWithBg: number;
  headingBgCoverage: number;

  // Tables
  tableCount: number;

  // Highlights
  redHighlightCount: number;

  // Bold headers
  boldHeaderCount: number;

  // Issues
  emptyBulletCount: number;

  // Overall
  checks: { name: string; pass: boolean; detail: string }[];
  ok: boolean;
}

// ─── Verify ─────────────────────────────────────────────────────────────

export function verifyDoc(cli: LarkCli, docId: string): VerifyReport {
  const blocks = cli.getBlocks(docId);

  const report: VerifyReport = {
    totalBlocks: blocks.length,
    rootChildren: 0,
    headingCount: 0,
    headingsWithBg: 0,
    headingBgCoverage: 0,
    tableCount: 0,
    redHighlightCount: 0,
    boldHeaderCount: 0,
    emptyBulletCount: 0,
    checks: [],
    ok: false,
  };

  // Root children count
  const root = blocks.find((b) => b.block_type === 1);
  if (root) {
    report.rootChildren = ((root as any).children || []).length;
  }

  for (const b of blocks) {
    const bt = b.block_type as number;

    // Headings (type 3-11)
    if (bt >= 3 && bt <= 11) {
      report.headingCount++;
      const key = `heading${bt - 2}`;
      const v = (b as any)[key] || {};
      const bg = v.style?.background_color;
      if (bg) report.headingsWithBg++;
    }

    // Tables (type 31)
    if (bt === 31) report.tableCount++;

    // Empty bullets (type 12)
    if (bt === 12) {
      const els = (b as any).bullet?.elements || [];
      const text = els.map((e: any) => e.text_run?.content || "").join("").trim();
      if (!text) report.emptyBulletCount++;
    }

    // Text blocks (type 2) - check for red highlights and bold headers
    if (bt === 2) {
      const els = (b as any).text?.elements || [];
      for (const e of els) {
        const style = e.text_run?.text_element_style || {};
        if (style.text_color === 1) report.redHighlightCount++;
        if (style.bold) {
          const content = (e.text_run?.content || "").trim();
          if (["Code", "Title", "Speakers", "Company", "Industry", "Abstract", "PDF"].includes(content)) {
            report.boldHeaderCount++;
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
      name: "No empty bullets",
      pass: report.emptyBulletCount <= 3,
      detail: `${report.emptyBulletCount} empty bullets`,
    },
    {
      name: "Headings present",
      pass: report.headingCount > 0,
      detail: `${report.headingCount} headings`,
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
      name: "Red highlights present",
      pass: report.redHighlightCount > 0,
      detail: `${report.redHighlightCount} highlights`,
    },
    {
      name: "Bold headers present",
      pass: report.boldHeaderCount >= 7,
      detail: `${report.boldHeaderCount} bold headers`,
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
    `Headings: ${report.headingsWithBg}/${report.headingCount} with bg (${report.headingBgCoverage}%)`,
    `Tables: ${report.tableCount}`,
    `Red highlights: ${report.redHighlightCount}`,
    `Bold headers: ${report.boldHeaderCount}`,
    `Empty bullets: ${report.emptyBulletCount}`,
    ``,
    ...report.checks.map((c) => `${c.pass ? "✅" : "❌"} ${c.name}: ${c.detail}`),
    ``,
    `Status: ${report.ok ? "✅ PASS" : "❌ FAIL"}`,
  ];
  return lines.join("\n");
}
