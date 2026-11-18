import { webkit } from "playwright";
import path from "node:path";
import { IPHONE_17_PRO_MAX, installSafeAreaInsets, layoutMetricsScript } from "./lib/iphone17ProMax.js";

const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await installSafeAreaInsets(page, 62, 34);
await page.goto(`${BASE}?fixture=es`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
await page.waitForTimeout(500);
await page.locator('[data-at-quote="call-ask-5950"]').first().click();
await page.waitForSelector("[data-order-ticket-sheet]", { timeout: 20_000 });
await page.waitForTimeout(400);
const m = await page.evaluate(layoutMetricsScript());
await page.screenshot({ path: path.join(OUT, "order-flow-es-440x956@3x-c-sheet-open.png") });
await page.locator("[data-order-ticket-backdrop]").click({ position: { x: 40, y: 80 } }).catch(() => {});
await browser.close();
console.log(JSON.stringify(m));