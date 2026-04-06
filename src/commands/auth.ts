/**
 * auth command — passthrough to lark-cli auth commands.
 *
 * Usage:
 *   lark-hirono auth status
 *   lark-hirono auth login --domain docs
 */

import { execFileSync } from "node:child_process";
import { findLarkCli } from "../cli.js";

export async function run(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return 0;
  }

  const cli = findLarkCli();
  const larkArgs = ["auth", ...args];

  try {
    execFileSync(cli, larkArgs, {
      stdio: "inherit",
      timeout: 60_000,
    });
    return 0;
  } catch (err: any) {
    if (err.status !== undefined) {
      return err.status as number;
    }
    console.error(`Auth error: ${err.message}`);
    return 1;
  }
}

function showHelp(): void {
  console.log(`
lark-hirono auth — Feishu/Lark authentication (passthrough to lark-cli)

Usage:
  lark-hirono auth status
  lark-hirono auth login --domain docs

This command delegates to lark-cli for all authentication operations.
`);
}
