import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  IPHONE_17_PRO_MAX,
  SECONDARY_VIEWPORT,
  installSafeAreaInsets,
  layoutMetricsScript,
} from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

const viewports = [
  { ...IPHONE_17_PRO_MAX, primary: true },
  { ...SECONDARY_VIEWPORT, primary: false },
];

const fixtures = ["spx", "nvda", "es"];
const CAPTURE_MODES = [
  { tag: "fixture", env: { VITE_AT_GLANCE_FLOW_FIXTURE: "1", VITE_AT_GLANCE_FLOW_REPLAY: "0" } },
  { tag: "replay", env: { VITE_AT_GLANCE_FLOW_FIXTURE: "0", VITE_AT_GLANCE_FLOW_REPLAY: "1" } },
];

async function ensureVite(extraEnv = {}) {
  const ok = await fetch(BASE + "?fixture=spx").then((r) => r.ok).catch(() => false);
  if (ok) return null;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BROWSER: "none", VITE_DEV_BYPASS_AUTH: "true", VITE_AT_GLANCE_TOP: "1", ...extraEnv },
  });
  child.unref();
  for (let i = 0; i < 120; i++) {
    if (await fetch(BASE + "?fixture=spx").then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

await mkdir(OUT, { recursive: true });
let vite = null;
const report = { capturedAt: new Date().toISOString(), primaryDevice: IPHONE_17_PRO_MAX.tag, modes: [] };

for (const mode of CAPTURE_MODES) {
  if (vite) vite.kill();
  try {
    const { execSync } = await import("node:child_process");
    execSync("pkill -f 'vite --host 127.0.0.1 --port 3000' || true");
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 600));
  vite = await ensureVite(mode.env);
  const modeReport = { mode: mode.tag, rows: [] };
  for (const vp of viewports) {
  for (const fx of fixtures) {
    const browser = await webkit.launch();
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor ?? 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    if (vp.primary) await installSafeAreaInsets(page, IPHONE_17_PRO_MAX.safeTop, IPHONE_17_PRO_MAX.safeBottom);
    await page.goto(`${BASE}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const m0 = await page.evaluate(layoutMetricsScript());
    const name = `glance-${mode.tag}-${fx}-${vp.tag}`;
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    modeReport.rows.push({ fixture: fx, viewport: vp.tag, primary: !!vp.primary, ...m0, file: `${name}.png` });
    await browser.close();
  }
  }
  report.modes.push(modeReport);
}

const burstBrowser = await webkit.launch();
const burstCtx = await burstBrowser.newContext({
  viewport: { width: IPHONE_17_PRO_MAX.width, height: IPHONE_17_PRO_MAX.height },
  deviceScaleFactor: 3,
  isMobile: true,
});
const burstPage = await burstCtx.newPage();
await installSafeAreaInsets(burstPage, IPHONE_17_PRO_MAX.safeTop, IPHONE_17_PRO_MAX.safeBottom);
await burstPage.goto(`${BASE}?fixture=spx&scene=default`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await burstPage.waitForSelector("[data-at-glance-top]");
const frames = [];
for (let i = 0; i < 4; i++) {
  const fn = path.join(OUT, `glance-burst-${i}-440x956@3x.png`);
  await burstPage.screenshot({ path: fn });
  frames.push(fn);
  await burstPage.waitForTimeout(400);
}
await burstBrowser.close();

await writeFile(path.join(OUT, "glance-heights.json"), JSON.stringify(report, null, 2));
if (vite) vite.kill();
console.log(JSON.stringify(report, null, 2));
console.log("burst frames:", frames.join(", "));