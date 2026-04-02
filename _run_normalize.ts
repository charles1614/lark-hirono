import { readFileSync, writeFileSync } from "node:fs";
import { normalizeMarkdown } from "./src/normalize.js";

const src = readFileSync("tests/fixtures/comprehensive.md", "utf-8");
const { text } = normalizeMarkdown(src);
writeFileSync("/tmp/comprehensive-normalized.md", text);
console.log(`Written ${text.split("\n").length} lines`);
