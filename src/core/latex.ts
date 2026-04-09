/**
 * LaTeX → Feishu equation tag conversion.
 *
 * Converts $...$  → <equation>...</equation>  (inline)
 * Converts $$...$$ → <equation>...</equation>  (display, own line)
 *
 * lark-cli docs +create accepts <equation> XML tags and renders them
 * as native Feishu equation blocks / inline equations.
 */

// ─── Core ──────────────────────────────────────────────────────────────

/**
 * Convert LaTeX $...$ and $$...$$ to <equation>...</equation> tags.
 *
 * Skips code fences (``` blocks) and inline code (`...`).
 * Handles both single-line and multi-line display math.
 */
export function convertLatexToEquationTags(md: string): { text: string; inline: number; display: number } {
  let inline = 0;
  let display = 0;

  // Split on code fences to protect them
  const parts = md.split(/(```[\s\S]*?```)/g);
  const result = parts.map((part) => {
    if (part.startsWith("```")) return part;

    // Phase 1: Multi-line display math  $$\n...\n$$
    part = part.replace(/\$\$\s*\n([\s\S]*?)\n\s*\$\$/g, (_match, content: string) => {
      display++;
      return `<equation>${content.trim()}</equation>`;
    });

    // Phase 2: Single-line display math  $$...$$
    part = part.replace(/\$\$([^$]+?)\$\$/g, (_match, content: string) => {
      display++;
      return `<equation>${content.trim()}</equation>`;
    });

    // Phase 3: Inline math  $...$
    // Protect inline code spans first
    const codeSpans: string[] = [];
    part = part.replace(/`[^`]+`/g, (m) => {
      codeSpans.push(m);
      return `\x00ICODE${codeSpans.length - 1}\x00`;
    });

    // Match inline $...$ but not:
    // - Empty: $$
    // - Currency-like: $100 (digit right after opening $, no LaTeX commands)
    // - Already converted: <equation>
    part = part.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_match, content: string) => {
      // Skip currency patterns: starts with digit and has no LaTeX operators
      if (/^\d/.test(content) && !/[\\^_{}]/.test(content)) return _match;
      inline++;
      return `<equation>${content}</equation>`;
    });

    // Restore inline code
    part = part.replace(/\x00ICODE(\d+)\x00/g, (_, i) => codeSpans[parseInt(i)]);

    return part;
  });

  return { text: result.join(""), inline, display };
}
