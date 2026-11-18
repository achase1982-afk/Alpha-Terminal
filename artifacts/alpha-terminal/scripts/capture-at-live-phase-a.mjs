import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

async function startVite() {
  try {
    execSync("pkill -f 'vite --host 127.0.0.1 --port 3000' || true", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 500));
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_DEV_BYPASS_AUTH: "true",
      VITE_AT_GLANCE_FLOW_FIXTURE: "1",
      VITE_AUTH_DISABLED: "true",
      VITE_AT_ORDER_SEND: "0",
    },
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}?fixture=spx`).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

function tapQuote(page, sel) {
  return page.locator(`[data-at-quote="${sel}"]`).click({ timeout: 15_000 });
}

await mkdir(OUT, { recursive: true });
const vite = await startVite();
const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);

await page.goto(`${BASE}?fixture=spx`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });
await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
await page.screenshot({ path: path.join(OUT, "at-live-phase-a-ladder-no-sheet-440x956@3x.png") });

await tapQuote(page, "call-ask-7545");
await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 10_000 });
await page.screenshot({ path: path.join(OUT, "at-live-phase-a-1leg-peek-sheet-440x956@3x.png") });

await tapQuote(page, "call-ask-7550");
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "at-live-phase-a-2leg-spread-sheet-440x956@3x.png") });

await browser.close();
try {
  process.kill(-vite.pid, "SIGTERM");
} catch {
  /* ignore */
}

console.log("captures written to", OUT);