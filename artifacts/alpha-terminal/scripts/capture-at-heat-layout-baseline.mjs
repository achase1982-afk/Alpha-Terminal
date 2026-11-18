/** One-off: capture pre-caption ladder PNG from a detached worktree at main@{1}. */
import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";
import { waitForLiveLadder } from "./lib/at-fixture-vite.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "fixtures/at-ladder-pre-heat-caption-440x956.png");
const WORKTREE =
  process.env.AT_HEAT_BASELINE_WORKTREE ?? "/tmp/at-base-851/artifacts/alpha-terminal";
const BASE = process.env.AT_HEAT_BASELINE_URL ?? "http://127.0.0.1:5174/dev/active-trader";

let vite = null;
async function ensureVite() {
  const probe = `${BASE}?fixture=spx`;
  if (await fetch(probe).then((r) => r.ok).catch(() => false)) return;
  vite = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
    cwd: WORKTREE,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BROWSER: "none", VITE_DEV_BYPASS_AUTH: "true", VITE_AT_GLANCE_TOP: "1" },
  });
  vite.unref();
  for (let i = 0; i < 90; i++) {
    if (await fetch(probe).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("worktree vite timeout");
}

await mkdir(path.dirname(OUT), { recursive: true });
await ensureVite();
const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);
await page.goto(`${BASE}?fixture=spx`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await waitForLiveLadder(page);
await page.screenshot({ path: OUT });
await browser.close();
if (vite?.kill) vite.kill();
console.log(JSON.stringify({ out: OUT, worktree: WORKTREE }));