import { webkit } from "playwright";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IPHONE_17_PRO_MAX, installSafeAreaInsets, layoutMetricsScript } from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

async function ensureVite() {
  const ok = await fetch(`${BASE}?fixture=spx`).then((r) => r.ok).catch(() => false);
  if (ok) return null;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_DEV_BYPASS_AUTH: "true",
      VITE_AT_GLANCE_TOP: "1",
      VITE_AT_GLANCE_FLOW_WORST: "1",
      VITE_AT_GLANCE_FLOW_FIXTURE: "0",
    },
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}?fixture=spx`).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

const vite = await ensureVite();
const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await installSafeAreaInsets(page, 62, 34);
await page.goto(`${BASE}?fixture=spx`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("[data-at-glance-flow-detail]", { timeout: 30_000 });
await page.waitForTimeout(500);
const m = await page.evaluate(layoutMetricsScript());
const file = "glance-worst-spx-440x956@3x.png";
await page.screenshot({ path: path.join(OUT, file) });
await browser.close();
if (vite) vite.kill();
console.log(JSON.stringify({ file, glancePx: m.glancePx, topChromePx: m.topChromePx }, null, 2));