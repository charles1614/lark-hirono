/**
 * verify command — fetch and verify an existing Feishu document.
 *
 * Usage:
 *   lark-hirono verify --doc <doc-id>
 */

import { LarkCli } from "../cli.js";
import { verifyDoc, formatReport } from "../verify/verify.js";

export async function run(args: string[]): Promise<number> {
  let docId = "";
  const flags: Record<string, boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      showHelp();
      return 0;
    }
    if (a === "--doc") {
      docId = args[++i] ?? "";
    } else if (a === "-v" || a === "--verbose") {
      flags.verbose = true;
    } else if (!a.startsWith("-")) {
      // Accept positional doc-id for convenience
      if (!docId) docId = a;
    }
  }

  if (!docId) {
    console.error("Error: Missing document ID");
    console.error("Usage: lark-hirono verify --doc <doc-id>");
    return 1;
  }

  const cli = new LarkCli({ retries: 3 });
  try {
    cli.status();
  } catch (err) {
    console.error(`Auth error: ${(err as Error).message}`);
    return 1;
  }

  const report = verifyDoc(cli, docId);
  console.log(formatReport(report));

  return report.ok ? 0 : 1;
}

function showHelp(): void {
  console.log(`
lark-hirono verify — Fetch and verify an existing Feishu document

Usage:
  lark-hirono verify --doc <doc-id>
  lark-hirono verify <doc-id>

Options:
  -v, --verbose  Verbose output

Checks:
  - Heading count and order
  - Table count and structure
  - Highlighted keywords
  - Residual HTML tags
`);
}
