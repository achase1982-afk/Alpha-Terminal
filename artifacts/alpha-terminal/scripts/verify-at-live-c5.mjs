import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-c5";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

async function switchToAt(page) {
  const viewSel = page.getByLabel("Options view");
  if ((await viewSel.count()) > 0) await viewSel.selectOption("at");
  else await page.getByRole("button", { name: "Active Trader", exact: true }).click();
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem(
    "alpha-terminal-storage",
    JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
  );
});

async function run(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await switchToAt(page);
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, { timeout: 90_000 });

  record(`view selector (${height}px)`, (await page.locator("[data-at-view-selector]").count()) > 0, "toolbar");
  const strike = await page.evaluate(() => {
    const spot = [...document.querySelectorAll("[data-at-strike]")].find((n) => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg.includes("251") || bg.includes("rgb(251");
    });
    return spot?.getAttribute("data-at-strike");
  });
  if (!strike) {
    record(`leg tray build (${height}px)`, false, "no ATM");
    return;
  }
  await page.locator(`[data-at-quote="call-ask-${strike}"]`).click();
  await page.waitForTimeout(400);
  const tray = (await page.locator("[data-at-leg-tray]").count()) > 0;
  record(`leg tray (${height}px)`, tray, tray ? "visible" : "missing");
  const next = Number(strike) + 5;
  const bidSel = `[data-at-quote="call-bid-${next}"]`;
  if ((await page.locator(bidSel).count()) > 0) {
    const trayY = await page.locator("[data-at-leg-tray]").boundingBox().catch(() => null);
    await page.locator(bidSel).click();
    await page.waitForTimeout(300);
    const trayY2 = await page.locator("[data-at-leg-tray]").boundingBox().catch(() => null);
    const stable = trayY && trayY2 && Math.abs(trayY.y - trayY2.y) < 2;
    record(`tray stable 2nd leg (${height}px)`, !!stable, stable ? "ok" : "moved");
  }
  await page.screenshot({ path: path.join(OUT, `live-at-c5-${height}px.png`) });
}

try {
  await run(956);
  await run(658);
  await switchToAt(page);
  await page.getByLabel("Options view").selectOption("chain").catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "live-at-c5-chain-view.png") });
} catch (err) {
  record("c5 capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-c5-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);