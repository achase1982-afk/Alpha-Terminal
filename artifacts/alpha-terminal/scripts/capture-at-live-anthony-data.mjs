/**
 * 440×956 WebKit captures: live SPX AT header (walls, flip, VIX, zones).
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";
import { waitForLiveLadder } from "./lib/at-fixture-vite.mjs";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-live-anthony-data";

await mkdir(OUT, { recursive: true });

const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);
await page.addInitScript(() => {
  localStorage.setItem(
    "alpha-terminal-storage",
    JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
  );
});

await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
await page.waitForTimeout(800);
const hit = page.locator("[data-at-subview-hit]").first();
if (await hit.count()) await hit.click();
else await page.locator('select[aria-label="Options view"]').selectOption("at");
await waitForLiveLadder(page);
await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });
await page.waitForTimeout(2500);

const metrics = await page.evaluate(() => {
  const flowPut = document.querySelector('[data-at-flow-wall="puts"]');
  const flowCall = document.querySelector('[data-at-flow-wall="calls"]');
  const flip = document.querySelector("[data-at-gamma-flip]");
  const vix = document.querySelector("[data-at-vix-last]");
  const low = document.querySelector("[data-at-day-low]");
  const lowZone = document.querySelector("[data-at-low-zone-slot]");
  const highZone = document.querySelector("[data-at-high-zone-slot]");
  return {
    callWallText: flowCall?.textContent?.trim() ?? null,
    putWallText: flowPut?.textContent?.trim() ?? null,
    gammaFlipText: flip?.textContent?.trim() ?? null,
    vixText: vix?.textContent?.trim() ?? null,
    dayLowText: low?.textContent?.trim() ?? null,
    lowZoneText: lowZone?.textContent?.trim() ?? null,
    highZoneText: highZone?.textContent?.trim() ?? null,
    heatLabel: document.querySelector("[data-at-ladder-heat-source]")?.textContent?.trim() ?? null,
    priorSessionLabel: document.body.innerText.includes("prior session"),
  };
});

await page.screenshot({ path: path.join(OUT, "at-live-anthony-440x956.png"), fullPage: false });
await writeFile(path.join(OUT, "metrics.json"), JSON.stringify({ live: LIVE, metrics }, null, 2));
console.log(JSON.stringify({ out: OUT, metrics }, null, 2));
await browser.close();