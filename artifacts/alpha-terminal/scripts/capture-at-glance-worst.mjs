import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installSafeAreaInsets, layoutMetricsScript } from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";
const FIXTURES = ["spx", "nvda", "es"];

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
  const ctx = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await installSafeAreaInsets(page, 62, 34);
  await page.goto(`${BASE}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-at-glance-flow-detail]", { timeout: 30_000 });
  await page.waitForSelector("[data-at-glance-flow='live']", { timeout: 10_000 });
  const flowText = await page.locator("[data-at-glance-flow='live']").innerText();
  const detailText = await page.locator("[data-at-glance-flow-detail]").innerText();
  const all = `${flowText}\n${detailText}`;
  if (!all.includes("1.23B")) {
    throw new Error(`${fx}: worst-case flow missing 1.23B (got: ${all.slice(0, 160)})`);
  }
  if (fx === "spx" && !all.includes("Calls bought")) {
    throw new Error("SPX missing plain Calls bought copy");
  }
  if ((fx === "nvda" || fx === "es") && !all.includes("Bought at ask")) {
    throw new Error(`${fx} missing plain tape copy`);
  }
  await page.waitForTimeout(400);
  const m = await page.evaluate(layoutMetricsScript());
  const file = `glance-worst-${fx}-440x956@3x.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  report.push({ fixture: fx, file, ...m, flowSnippet: flowText.slice(0, 80) });
  await ctx.close();
}

await browser.close();
vite.kill();
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), report }, null, 2));