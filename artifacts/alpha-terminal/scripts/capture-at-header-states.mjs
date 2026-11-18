import { webkit, devices } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const FIXTURE = process.env.AT_VERIFY_BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-header-states";

await mkdir(OUT, { recursive: true });

const IPHONE = devices["iPhone 17 Pro Max"] ?? devices["iPhone 14 Pro Max"];
const browser = await webkit.launch();

async function capture(url, name, fixture) {
  const context = await browser.newContext({
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
  }
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
  await context.close();
}

await capture(LIVE, "at-header-live-closed-440x956.png", false);
await capture(
  `${FIXTURE}/dev/active-trader?fixture=spx&scene=header-down`,
  "at-header-fixture-full-440x956.png",
  true,
);
await browser.close();
console.log(JSON.stringify({ out: OUT }, null, 2));