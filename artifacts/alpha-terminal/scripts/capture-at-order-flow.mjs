import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  IPHONE_17_PRO_MAX,
  installSafeAreaInsets,
  layoutMetricsScript,
} from "./lib/iphone17ProMax.js";

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
      VITE_AT_ORDER_SEND: "0",
    },
  });
  child.unref();
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${BASE}?fixture=spx`).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

async function runFixture(vp, fixture, useSafeArea) {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor ?? 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  if (useSafeArea) await installSafeAreaInsets(page, IPHONE_17_PRO_MAX.safeTop, IPHONE_17_PRO_MAX.safeBottom);
  const strike = fixture === "nvda" ? "182.5" : fixture === "es" ? "5950" : "7545";
  const askSel = `[data-at-quote="call-ask-${strike}"]`;
  const url = `${BASE}?fixture=${fixture}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.waitForSelector(askSel, { timeout: 60_000, state: "visible" });

  const prefix = `order-flow-${fixture}-${vp.tag}`;
  const shots = [];

  const snap = async (suffix, metrics = true) => {
    const file = `${prefix}-${suffix}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
    const m = metrics ? await page.evaluate(layoutMetricsScript()) : null;
    shots.push({ file, metrics: m });
    return m;
  };

  await snap("a-before-tap");
  const ask = page.locator(askSel).first();
  await ask.scrollIntoViewIfNeeded().catch(() => undefined);
  const tapPromise = ask.click({ timeout: 15_000 });
  await page.waitForTimeout(120);
  await snap("b-mid-animation", false);
  await tapPromise;
  await page.waitForSelector('[data-at-sheet-detent="peek"]', { timeout: 20_000 });
  await page.waitForTimeout(400);
  const openM = await snap("c-sheet-open");
  await page.waitForSelector("[data-at-mobile-peek]", { timeout: 10_000 });
  const tpVisible = await page.getByText("Take profit").first().isVisible().catch(() => false);
  if (!tpVisible) {
    await page.locator('[data-at-mobile-peek] input[type="checkbox"]').first().check().catch(() => undefined);
  }
  await snap("d-tp-visible");
  const limitInput = page.locator('[data-at-mobile-peek] input[inputmode="decimal"]');
  const limitVal = await limitInput.inputValue().catch(() => "");
  if (!limitVal?.trim()) {
    await limitInput.fill("3.50");
    await page.waitForTimeout(150);
  }
  await page.getByTestId("at-mobile-review").click({ timeout: 10_000 });
  await page.waitForSelector('[data-at-sheet-detent="confirm"]', { timeout: 15_000 });
  await page.waitForTimeout(350);
  await snap("e-ticket-full");
  const backdrop = page.locator("[data-order-ticket-backdrop]");
  if (await backdrop.count()) {
    await backdrop.click({ timeout: 5000, position: { x: 40, y: 80 } }).catch(() => undefined);
  } else {
    await page.getByTestId("at-mobile-review").click({ timeout: 3000 }).catch(() => undefined);
  }
  await page.waitForSelector("[data-order-ticket-sheet]", { state: "detached", timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  const afterM = await snap("f-dismissed");

  await browser.close();
  return { fixture, viewport: vp.tag, strikes: strike, askSel, shots, sheetOpen: openM, dismissed: afterM };
}

await mkdir(OUT, { recursive: true });
const vite = await ensureVite();
const report = { capturedAt: new Date().toISOString(), primary: IPHONE_17_PRO_MAX.tag, fixtures: [] };

for (const fx of ["spx", "nvda", "es"]) {
  report.fixtures.push(await runFixture(IPHONE_17_PRO_MAX, fx, true));
}

await writeFile(path.join(OUT, "glance-order-flow.json"), JSON.stringify(report, null, 2));
if (vite) vite.kill();
console.log(JSON.stringify(report, null, 2));