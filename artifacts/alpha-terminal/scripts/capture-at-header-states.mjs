import { webkit, devices } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AT_FIXTURE_BASE, ensureAtFixtureVite, waitForLiveLadder } from "./lib/at-fixture-vite.mjs";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const FIXTURE = process.env.AT_VERIFY_BASE ?? AT_FIXTURE_BASE;
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-header-states";

await mkdir(OUT, { recursive: true });
let viteChild = null;
try {
  viteChild = await ensureAtFixtureVite();
} catch {
  /* live-only capture */
}

const IPHONE = devices["iPhone 17 Pro Max"] ?? devices["iPhone 14 Pro Max"];
const liveBrowser = await webkit.launch();
const fixtureBrowser = await import("playwright").then((m) => m.chromium.launch());

async function capture(url, name, fixture, browserType) {
  const context = await browserType.newContext({
    ...IPHONE,
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  if (!fixture) {
    await page.addInitScript(() => {
      localStorage.setItem(
        "alpha-terminal-storage",
        JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
      );
    });
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (fixture) {
    await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });
    await page.waitForTimeout(2500);
  } else {
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
    await viewSel.first().selectOption("at").catch(() => undefined);
    await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });
    await waitForLiveLadder(page);
  }
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
  await context.close();
}

await capture(LIVE, "at-header-live-closed-440x956.png", false, liveBrowser);
const fixtureUrl = FIXTURE.includes("/dev/active-trader")
  ? `${FIXTURE}?fixture=spx&scene=header-down`
  : `${FIXTURE}/dev/active-trader?fixture=spx&scene=header-down`;
await capture(fixtureUrl, "at-header-fixture-full-440x956.png", true, fixtureBrowser);
await liveBrowser.close();
await fixtureBrowser.close();
if (viteChild) viteChild.kill();
console.log(JSON.stringify({ out: OUT }, null, 2));