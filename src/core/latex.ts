/**
 * LaTeX delimiter normalization for Feishu upload.
 *
 * lark-cli's markdown parser applies italic parsing to _ inside math delimiters
 * ($, $$, <equation>), breaking multi-subscript formulas.
 *
 * Fix: insert \mkern0mu between } and _ to break the italic trigger.
 * \mkern0mu is a zero-width TeX kern (renders as nothing) — it ends with the
 * letter 'u', which is a word character. Markdown italic openers require the _
 * to be preceded by a non-word char; inserting \mkern0mu ensures _ is preceded
 * by 'u' instead of '}', making it invisible to the italic parser.
 *
 * Strategy:
 *   \[...\]  →  $\mkern0mu-protected content$  (display → inline)
 *   \(...\)  →  $\mkern0mu-protected content$  (inline)
 *   $$\n...\n$$  →  $\mkern0mu-protected content$  (collapse multi-line)
 *   $...$    →  $\mkern0mu-protected content$  (protect pass-through)
 *   $$...$$ →  $$\mkern0mu-protected content$$  (protect pass-through)
 */

// ─── Core ──────────────────────────────────────────────────────────────

/**
 * Insert \mkern0mu between } and _ to prevent lark-cli markdown italic parsing.
 *
 * lark-cli treats _..._ as italic when _ is preceded by a non-word char like }.
 * \mkern0mu is a zero-width kern whose last character is 'u' (word char),
 * so _{\text{...}} after a closing } becomes }\mkern0mu_{\text{...}},
 * which lark-cli's italic parser no longer triggers on.
 *
 * Rendering: \mkern0mu inserts exactly 0 math units of space — visually identical
 * to the original formula in KaTeX/Feishu.
 */
function protectSubscripts(content: string): string {
  // Insert \mkern0mu between } and _ (subscript after closing brace)
  return content.replace(/\}(?=_)/g, "}\\mkern0mu");
}

/**
 * Normalize LaTeX math delimiters for lark-cli.
 *
 * Converts \[...\] and \(...\) to $...$ with protected subscripts.
 * Collapses multi-line $$...$$ to single-line with protected subscripts.
 * Also protects existing $...$ and $$...$$ pass-through content.
 *
 * Skips code fences (``` blocks) and inline code (`...`).
 */
export function convertLatexToEquationTags(md: string): { text: string; inline: number; display: number } {
  let inline = 0;
  let display = 0;

  // Split on code fences to protect them
  const parts = md.split(/(```[\s\S]*?```)/g);
  const result = parts.map((part) => {
    if (part.startsWith("```")) return part;

    // Phase 1: \[...\] display math (multi-line or single-line)
    // Used by Kimi, Claude, GPT for display equations.
    // Guard: must contain a LaTeX operator to avoid matching references like \[1\] or \[RFC\].
    part = part.replace(/\\\[([\s\S]*?)\\\]/g, (_match, content: string) => {
      const trimmed = content.trim();
      if (!/[\\^_{}=]/.test(trimmed)) return _match;
      display++;
      return `$${protectSubscripts(trimmed)}$`;
    });

    // Phase 2: \(...\) inline math
    // Used by Kimi, Claude, GPT for inline equations.
    // Guard: must contain a LaTeX operator to avoid matching escaped parens.
    part = part.replace(/\\\(([\s\S]*?)\\\)/g, (_match, content: string) => {
      const trimmed = content.trim();
      if (!/[\\^_{}=]/.test(trimmed)) return _match;
      inline++;
      return `$${protectSubscripts(trimmed)}$`;
    });

    // Phase 3: Collapse multi-line display math $$\n...\n$$ to single-line.
    part = part.replace(/\$\$\s*\n([\s\S]*?)\n\s*\$\$/g, (_match, content: string) => {
      display++;
      return `$${protectSubscripts(content.trim())}$`;
    });

    // Phase 4: Protect existing $...$ and $$...$$ pass-through content.
    // Apply \mkern0mu protection so user-written formulas don't break italic parsing.
    part = part.replace(/\$\$([^$\n]+)\$\$/g, (_, content: string) => {
      return `$$${protectSubscripts(content)}$$`;
    });
    part = part.replace(/(?<!\$)\$(?!\$)([^\n$]+)\$(?!\$)/g, (_, content: string) => {
      return `$${protectSubscripts(content)}$`;
    });

    return part;
  });

  return { text: result.join(""), inline, display };
}
