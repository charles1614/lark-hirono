/**
 * Config loader — reads lark-hirono.json and merges with defaults.
 *
 * Resolution order: defaults → lark-hirono.json → CLI flags
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────

export interface Config {
  wikiSpace: string;
  wikiNode: string;
  bgMode: "light" | "dark";
  highlight: boolean;
  stripTitle: boolean;
  imageDir: string | null;
}

export interface ConfigFile {
  wikiSpace?: string;
  wikiNode?: string;
  bgMode?: "light" | "dark";
  highlight?: boolean;
  stripTitle?: boolean;
  imageDir?: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────

const DEFAULTS: Config = {
  wikiSpace: "7620053427331681234",
  wikiNode: "UNtHwabqNiqc8ZkzvLscWNnwnYd",
  bgMode: "light",
  highlight: true,
  stripTitle: false,
  imageDir: null,
};

// ─── Config File Discovery ──────────────────────────────────────────────

/**
 * Find lark-hirono.json by walking up from cwd.
 * Stops at .git directory or filesystem root.
 */
function findConfigFile(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);

  while (true) {
    const configPath = join(dir, "lark-hirono.json");
    if (existsSync(configPath)) return configPath;

    // Stop at .git
    if (existsSync(join(dir, ".git"))) return null;

    const parent = dirname(dir);
    if (parent === dir) return null; // reached root
    dir = parent;
  }
}

/**
 * Load and parse lark-hirono.json if it exists.
 */
function loadConfigFile(path: string): ConfigFile {
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as ConfigFile;
  } catch (err) {
    console.error(`Warning: Failed to parse ${path}: ${(err as Error).message}`);
    return {};
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Load config with resolution: defaults → file → overrides.
 *
 * @param overrides - CLI flag overrides
 * @param configPath - Explicit config path (optional)
 */
export function loadConfig(overrides: Partial<Config> = {}, configPath?: string): Config {
  const file = configPath ?? findConfigFile();
  const fileConfig = file ? loadConfigFile(file) : {};

  return {
    wikiSpace: overrides.wikiSpace ?? fileConfig.wikiSpace ?? DEFAULTS.wikiSpace,
    wikiNode: overrides.wikiNode ?? fileConfig.wikiNode ?? DEFAULTS.wikiNode,
    bgMode: overrides.bgMode ?? fileConfig.bgMode ?? DEFAULTS.bgMode,
    highlight: overrides.highlight ?? fileConfig.highlight ?? DEFAULTS.highlight,
    stripTitle: overrides.stripTitle ?? fileConfig.stripTitle ?? DEFAULTS.stripTitle,
    imageDir: overrides.imageDir ?? fileConfig.imageDir ?? DEFAULTS.imageDir,
  };
}

/**
 * Get the path to the config file (if found).
 */
export function getConfigPath(): string | null {
  return findConfigFile();
}
