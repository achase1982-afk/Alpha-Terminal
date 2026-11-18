import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-ladder-volume-live";

async function openAt(page, symbolStorage) {
  await page.setViewportSize({ width: 440, height: 956 });
  await page.addInitScript((sym) => {
    localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: sym }, version: 35 }));
  }, symbolStorage);
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.locator('[data-at-view-selector] select').first().selectOption("at");
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForTimeout(2_500);
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

await openAt(page, "$SPX");
const spxTag = await page.locator("[data-at-ladder-heat-source]").innerText().catch(() => "");
await page.screenshot({ path: path.join(OUT, "at-live-spx-ladder-volume-440x956.png"), fullPage: false });
console.log(JSON.stringify({ spxTag }, null, 2));

// NVDA: switch symbol in terminal chrome if available
await page.getByRole("button", { name: "MARKETS", exact: true }).click({ timeout: 30_000 }).catch(() => undefined);
await page.waitForTimeout(400);
await page.keyboard.press("Meta+k").catch(() => page.keyboard.press("Control+k"));
await page.waitForTimeout(300);
await page.getByPlaceholder(/search/i).fill("NVDA").catch(() => undefined);
await page.keyboard.press("Enter").catch(() => undefined);
await page.waitForTimeout(800);
await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 30_000 }).catch(() => undefined);
await page.locator('[data-at-view-selector] select').first().selectOption("at");
await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 }).catch(() => undefined);
await page.waitForTimeout(3_000);
const nvdaTag = await page.locator("[data-at-ladder-heat-source]").innerText().catch(() => "");
await page.screenshot({ path: path.join(OUT, "at-live-nvda-ladder-volume-440x956.png"), fullPage: false });
console.log(JSON.stringify({ nvdaTag }, null, 2));

await browser.close();