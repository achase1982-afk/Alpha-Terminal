import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

const viewports = [
  { tag: "440x956", width: 440, height: 956 },
  { tag: "390x844", width: 390, height: 844 },
];

const fixtures = ["spx", "nvda", "es"];

async function ensureVite() {
  try {
    execSync("fuser -k 3000/tcp 2>/dev/null || true");
  } catch {
    /* ignore */
  }
  const ok = await fetch(BASE + "?fixture=spx").then((r) => r.ok).catch(() => false);
  if (ok) return null;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BROWSER: "none", VITE_DEV_BYPASS_AUTH: "true", VITE_AT_GLANCE_TOP: "1" },
  });
  child.unref();
  for (let i = 0; i < 120; i++) {
    if (await fetch(BASE + "?fixture=spx").then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

function metrics(page) {
  return page.evaluate(() => {
    const glance = document.querySelector("[data-at-glance-top]");
    const ladder = document.querySelector("[data-at-ladder-scroll]");
    return {
      glancePx: glance ? Math.round(glance.getBoundingClientRect().height) : 0,
      ladderPx: ladder ? Math.round(ladder.getBoundingClientRect().height) : 0,
      viewportH: window.innerHeight,
    };
  });
}

await mkdir(OUT, { recursive: true });
const vite = await ensureVite();
const report = { capturedAt: new Date().toISOString(), rows: [] };

for (const vp of viewports) {
  for (const fx of fixtures) {
    const browser = await webkit.launch();
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const m0 = await metrics(page);
    const name = `glance-${fx}-${vp.tag}`;
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    report.rows.push({ fixture: fx, viewport: vp.tag, ...m0, file: `${name}.png` });
    await browser.close();
  }
}

const burstBrowser = await webkit.launch();
const burstCtx = await burstBrowser.newContext({ viewport: { width: 440, height: 956 }, isMobile: true });
const burstPage = await burstCtx.newPage();
await burstPage.goto(`${BASE}?fixture=spx&scene=default`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await burstPage.waitForSelector("[data-at-glance-top]");
const frames = [];
for (let i = 0; i < 4; i++) {
  const fn = path.join(OUT, `glance-burst-${i}.png`);
  await burstPage.screenshot({ path: fn });
  frames.push(fn);
  await burstPage.waitForTimeout(400);
}
await burstBrowser.close();

await writeFile(path.join(OUT, "glance-heights.json"), JSON.stringify(report, null, 2));
if (vite) vite.kill();
console.log(JSON.stringify(report, null, 2));
console.log("burst frames:", frames.join(", "));