import { execFileSync } from "node:child_process";
const lark = "/tmp/openclaw/larkcli/node_modules/.bin/lark-cli";

// Build a table with 50 rows mimicking All Industries structure
const rows = [];
for (let i = 0; i < 48; i++) {
  rows.push(`| S${String(82000 + i).padStart(5, "0")} | Session ${i} | Speaker | Company | All Industries | Some abstract text for session ${i}. | [PDF](https://x.pdf) |`);
}
// Insert the problematic rows
rows.splice(39, 0, `| S82486 | 从 M2 到 M2.5 | 鹏宇 赵 | MiniMax | All Industries | M2 系列介绍。 | [PDF](https://hirono.litenext.digital/gtc-2026/pdfs/S82486.pdf) |`);
rows.splice(40, 0, `| S82795 | Build-a-Claw Event |  |  | All Industries | <p>Stop by NVIDIA's build-a-claw event in the GTC Park running all week to customize and deploy a proactive, always-on AI assistant.<br><br></p><p>To run the custom agent, bring your own NVIDIA DGX Spark. Or buy one at the Gear Store (SJCC street level) or MicroCenter pop-up (GTC Park).</p><br> To run the custom agent, use cloud compute provided onsite, or harness local accelerated computing by bringing your NVIDIA DGX Spark or GeForce RTX laptop, with no personal data on the device. NVIDIA hardware — including DGX Spark — will also be available to buy on site at Gear Store (SJCC street level) and Micro Center (pop-up at GTC Park).<br><br> <strong>Helpful material to review before you arrive:</strong><br> <p><a href="https://www.nvidia.com/gtc/build-a-claw/disclaimers/">Install & Demo Guide | Notice & Disclaimers</a><br> <a href="https://brev.nvidia.com/launchable/deploy?launchableID=env-3Ap3tL55zq4a8kew1AuW0FpSLsg">Brev Launchable</a><br> <br><br> <strong>Hours of operation:</strong><br> Monday: 8:00 am - 5:00 pm PT (except during keynote)<br> Tuesday: 8:00 am - 5:00 pm PT<br> Wednesday: 8:00 am - 5:00 pm PT<br> Thursday: 8:00 am - 5:00 pm PT<br><br> <strong>Location: GTC Park</strong><br></p> |  |`);

const md = `| Code | Title | Speakers | Company | Industry | Abstract | PDF |
|---|---|---|---|---|---|---|
${rows.join("\n")}`;

console.log(`Created table with ${rows.length} rows, ${Buffer.byteLength(md, "utf-8")} bytes`);

const out = execFileSync(lark, [
  "docs", "+create",
  "--title", "S82795 50-row lark-table test",
  "--markdown", md,
  "--wiki-space", "7620053427331681234"
], { encoding: "utf-8", timeout: 60000 });

const result = JSON.parse(out);
console.log(result.data?.doc_url || "failed: " + out.substring(0, 200));
