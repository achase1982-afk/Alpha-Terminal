import { execSync } from "node:child_process";
import { webkit, devices } from "playwright";

const BASE = process.env.AT_MEASURE_BASE ?? "http://127.0.0.1:4173";
const IPHONE = devices["iPhone 14 Pro Max"];

function mainSha() {
  return execSync("git rev-parse main", { encoding: "utf8" }).trim();
}

const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
  localStorage.setItem("VITE_AT_GLANCE_FLOW_FIXTURE", "1");
});
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 }).catch(() => undefined);
await page.locator('[data-at-view-selector] select').first().selectOption("at").catch(() => undefined);
await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });
const box = await page.locator("[data-at-glance-top]").boundingBox();
await browser.close();
console.log(JSON.stringify({ base: BASE, mainSha: mainSha(), headerHeightPx: box?.height ?? null }, null, 2));