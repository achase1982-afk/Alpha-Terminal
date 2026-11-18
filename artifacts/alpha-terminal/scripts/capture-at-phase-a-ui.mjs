import { webkit } from "playwright";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installSafeAreaInsets, layoutMetricsScript } from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const REPO = path.resolve(PKG, "../..");
const GLANCE = path.join(PKG, "src/components/active-trader/AtGlanceTop.tsx");
const GLANCE_BAK = path.join("/tmp", "AtGlanceTop.phase-a.bak");
const OUT = "/opt/cursor/artifacts";

async function stopVite(child) {
  try {
    child?.kill();
    execSync("pkill -f 'vite --host 127.0.0.1 --port 3000' || true", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 500));
}

async function startVite(env = {}) {
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_DEV_BYPASS_AUTH: "true",
      VITE_AT_GLANCE_TOP: "1",
      VITE_AT_GLANCE_FLOW_FIXTURE: "1",
      ...env,
    },
  });
  child.unref();
  const base = "http://127.0.0.1:3000/dev/active-trader";
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${base}?fixture=spx`).then((r) => r.ok).catch(() => false)) return { child, base };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

async function shot(page, base, name) {
  await page.goto(`${base}?fixture=spx`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(layoutMetricsScript());
  await page.screenshot({ path: path.join(OUT, name) });
  return m;
}

function mainGlanceFromGit() {
  return execSync(`git show main:artifacts/alpha-terminal/src/components/active-trader/AtGlanceTop.tsx`, {
    cwd: REPO,
    encoding: "utf8",
  });
}

await mkdir(OUT, { recursive: true });
await copyFile(GLANCE, GLANCE_BAK);

const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await installSafeAreaInsets(page, 62, 34);

let beforeMetrics = null;
let viteChild = null;
let viteBase = "";
try {
  await writeFile(GLANCE, mainGlanceFromGit());
  ({ child: viteChild, base: viteBase } = await startVite());
  beforeMetrics = await shot(page, viteBase, "at-phase-a-spx-glance-before-440x956@3x.png");
} catch (e) {
  console.warn("before capture:", e.message);
} finally {
  await stopVite(viteChild);
}

await copyFile(GLANCE_BAK, GLANCE);
({ child: viteChild, base: viteBase } = await startVite());
const afterMetrics = await shot(page, viteBase, "at-phase-a-spx-glance-after-440x956@3x.png");
await page.locator("[data-at-advanced-order-trigger]").click().catch(() => undefined);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "at-phase-a-spx-advanced-order-after-440x956@3x.png") });

await browser.close();
await stopVite(viteChild);

console.log(
  JSON.stringify(
    {
      beforeGlancePx: beforeMetrics?.glancePx ?? null,
      afterGlancePx: afterMetrics.glancePx,
      maxAllowed: 191,
    },
    null,
    2,
  ),
);