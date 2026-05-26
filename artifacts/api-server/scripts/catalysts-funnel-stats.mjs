/**
 * One-off: print catalysts funnel + filter breakdown (requires DATABASE_URL).
 * Usage: node scripts/catalysts-funnel-stats.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");

const child = spawn(
  "pnpm",
  ["exec", "tsx", "-e", `
import "../src/loadEnv.js";
import { buildCatalystsFeed } from "../src/lib/catalysts/buildCatalystsFeed.js";
(async () => {
  const feed = await buildCatalystsFeed();
  console.log(JSON.stringify({
    funnel: feed.funnel,
    symbols: feed.cards.map((c) => c.symbol),
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
`],
  { cwd: root, stdio: "inherit", shell: true },
);

child.on("exit", (code) => process.exit(code ?? 1));
