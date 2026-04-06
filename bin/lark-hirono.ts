#!/usr/bin/env node
/**
 * lark-hirono CLI — Markdown to styled Feishu documents.
 *
 * Usage:
 *   lark-hirono <command> [options]
 *
 * Commands:
 *   upload     Create new Feishu document from local markdown
 *   optimize   Update existing Feishu document with pipeline transforms
 *   fetch      Retrieve Feishu document as markdown
 *   analyze    Analyze markdown document structure
 *   highlight  Extract/apply keyword highlights
 *   verify     Fetch and verify an existing document
 *   auth       Feishu authentication (passthrough to lark-cli)
 */

import * as upload from "../src/commands/upload.js";
import * as optimize from "../src/commands/optimize.js";
import * as fetch from "../src/commands/fetch.js";
import * as analyze from "../src/commands/analyze.js";
import * as highlight from "../src/commands/highlight.js";
import * as verify from "../src/commands/verify.js";
import * as auth from "../src/commands/auth.js";

const COMMANDS = {
  upload,
  optimize,
  fetch,
  analyze,
  highlight,
  verify,
  auth,
} as const;

type CommandName = keyof typeof COMMANDS;

function showHelp(): void {
  console.log(`
lark-hirono — Markdown to styled Feishu documents

Usage:
  lark-hirono <command> [options]

Commands:
  upload <input.md>       Create new styled Feishu document from local markdown
  optimize --doc <id>     Update existing document with pipeline transforms
  fetch --doc <id>        Retrieve Feishu document as markdown
  analyze <input.md>      Analyze markdown document structure
  highlight <subcommand>  Extract/apply keyword highlights
  verify --doc <id>       Fetch and verify an existing document
  auth <subcommand>       Feishu authentication (passthrough to lark-cli)

Options:
  -h, --help     Show help for a command
  -v, --verbose  Verbose logging

Run "lark-hirono <command> --help" for more information.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    process.exit(0);
  }

  const [cmd, ...rest] = args;

  if (!Object.hasOwn(COMMANDS, cmd)) {
    console.error(`Unknown command: ${cmd}`);
    console.error("Run 'lark-hirono --help' for available commands.");
    process.exit(1);
  }

  const command = COMMANDS[cmd as CommandName];
  const exitCode = await command.run(rest);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
