import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { glanceStackOverlapScript, installSafeAreaInsets, layoutMetricsScript } from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";
const FIXTURES = ["spx", "nvda", "es"];
const WINDOWS = ["1m", "5m", "hr"];

const VITE_ENV = {
  ...process.env,
  BROWSER: "none",
  VITE_DEV_BYPASS_AUTH: "true",
  VITE_AT_GLANCE_TOP: "1",
  VITE_AT_GLANCE_FLOW_WORST: "1",
  VITE_AT_GLANCE_FLOW_FIXTURE: "0",
  VITE_AT_GLANCE_FLOW_REPLAY: "0",
};

function stopViteOn3000() {
  try {
    execSync("pkill -f 'vite --host 127.0.0.1 --port 3000' || true", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

async function startVite() {
  stopViteOn3000();
  await new Promise((r) => setTimeout(r, 600));
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: VITE_ENV,
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    const ok = await fetch(`${BASE}?fixture=spx`).then((r) => r.ok).catch(() => false);
    if (ok) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

await mkdir(OUT, { recursive: true });
const vite = await startVite();
const browser = await webkit.launch();
const report = [];

for (const fx of FIXTURES) {
  for (const win of WINDOWS) {
    const ctx = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await installSafeAreaInsets(page, 62, 34);
    await page.goto(`${BASE}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector("[data-at-glance-flow='live']", { timeout: 30_000 });
    await page.locator(`[data-at-glance-flow-seg="${win}"]`).click();
    await page.waitForSelector(`[data-at-glance-flow-window="${win}"]`, { timeout: 5_000 });
    const fonts = await page.evaluate(() => {
      const body = document.querySelector("[data-at-glance-flow-body]");
      const seg = document.querySelector("[data-at-glance-flow-seg] button");
      const cs = (el) => (el ? getComputedStyle(el).fontSize : null);
      return { bodyFontPx: cs(body), segFontPx: cs(seg) };
    });
    const bodyText = await page.locator("[data-at-glance-flow-body]").innerText();
    if (!bodyText.includes("1.23B")) {
      throw new Error(`${fx}/${win}: missing 1.23B in body: ${bodyText.slice(0, 120)}`);
    }
    const stack = await page.evaluate(glanceStackOverlapScript());
    if (!stack.ok) {
      throw new Error(`${fx}/${win}: glance overlap ${stack.overlapPx}px (glancePx=${stack.glancePx})`);
    }
  const m = await page.evaluate(layoutMetricsScript());
    if (m.glancePx > 110) {
      throw new Error(`${fx}/${win}: glancePx ${m.glancePx} > 110`);
    }
    await page.waitForTimeout(300);
    const file = `glance-worst-${fx}-${win}-440x956@3x.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    report.push({ fixture: fx, window: win, file, stack, fonts, ...m, flowSnippet: bodyText.slice(0, 72) });
    await ctx.close();
  }
}

await browser.close();
vite.kill();
const jsonPath = path.join(OUT, "glance-worst-capture-report.json");
await writeFile(jsonPath, JSON.stringify({ capturedAt: new Date().toISOString(), report }, null, 2));
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), report }, null, 2));