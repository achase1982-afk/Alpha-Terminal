/**
 * Offline 15/30/60s window checks on a fixed SPX flow_1s tape (timestamped 1s buckets).
 * Run: node scripts/desk-flow-window-tape-report.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = process.env.AT_FLOW_TAPE_OUT ?? "/opt/cursor/artifacts/at-flow-window-tape";

const report = execFileSync(
  "pnpm",
  ["exec", "vitest", "run", "src/lib/active-trader/__tests__/deskFlowNetPremium.test.ts", "--reporter=json"],
  {
    cwd: new URL("../", import.meta.url).pathname,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  },
);

await mkdir(OUT, { recursive: true });
const summary = {
  generatedAt: new Date().toISOString(),
  dataPath: "desk live-flow SSE flow_1s buckets (1s aggregation over timestamped option prints; PR #660)",
  windowsMs: [15_000, 30_000, 60_000],
  scenarios: [
    "sustained call bias — calls track Buy across 15/30/60s",
    "alternating call bursts — calls track Mixed or Quiet (hysteresis)",
    "stale rx gap — stale, not live",
    "empty stream — no_prints",
  ],
  vitest: report.slice(0, 2000),
};
await writeFile(path.join(OUT, "flow-window-tape-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));