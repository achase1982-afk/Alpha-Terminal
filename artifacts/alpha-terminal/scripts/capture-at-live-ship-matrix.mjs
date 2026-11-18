/**
 * Live 440×956 WebKit captures for Anthony ship matrix + header walls.
 */
import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-live-ship-matrix";

const tap = (page, sel) => page.locator(`[data-at-quote="${sel}"]`).click({ timeout: 20_000 });

async function openAtSpx(page) {
  await page.setViewportSize({ width: 440, height: 956 });
  await page.addInitScript(() => {
    localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
  });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.locator('[data-at-view-selector] select').first().selectOption("at");
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, { timeout: 90_000 });
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);

await openAtSpx(page);
await page.screenshot({ path: path.join(OUT, "01-empty-header-walls-440x956.png") });
const headerText = await page.locator("[data-at-glance-top]").innerText().catch(() => "");
const wallOk = /rolls at open|Pin|PIN/i.test(headerText) || headerText.includes("—");
console.log(JSON.stringify({ headerText: headerText.slice(0, 200), wallOk }));

await tap(page, "call-ask-7545");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, "02-one-leg-440x956.png") });

await page.locator("button", { hasText: "CLEAR" }).click().catch(() => undefined);
await page.waitForTimeout(300);
await tap(page, "call-ask-7545");
await tap(page, "call-bid-7550");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, "03-vertical-2leg-440x956.png") });

await page.locator("button", { hasText: "CLEAR" }).click().catch(() => undefined);
await page.waitForTimeout(300);
await tap(page, "put-bid-7530");
await tap(page, "put-ask-7520");
await tap(page, "call-bid-7550");
await tap(page, "call-ask-7555");
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, "04-condor-4leg-440x956.png") });

await page.getByRole("button", { name: /Settings|SET/i }).first().click({ timeout: 10_000 }).catch(() => undefined);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "05-picker-settings-440x956.png") });

await page.locator("[data-testid='options-chain-order-sheet-advanced']").click({ timeout: 12_000 }).catch(() =>
  page.getByRole("button", { name: /Advanced/i }).click({ timeout: 12_000 }),
);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, "06-advanced-orders-440x956.png") });

const heatTag = await page.locator("[data-at-ladder-heat-source]").innerText().catch(() => "");
console.log(JSON.stringify({ heatTag, out: OUT }));

await browser.close();