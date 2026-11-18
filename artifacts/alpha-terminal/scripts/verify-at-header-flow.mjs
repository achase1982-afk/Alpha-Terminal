import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertAtHeaderLayout } from "./lib/at-header-layout-assert.mjs";
import { waitForLiveLadder } from "./lib/at-fixture-vite.mjs";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-header-flow-live";
const IPHONE = devices["iPhone 17 Pro Max"] ?? devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
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
  localStorage.setItem("at-net-premium-window-ms", "30000");
});

async function openAt() {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("at").catch(() => undefined);
  await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });
}

async function assertHeaderLayout() {
  const header = page.locator("[data-at-glance-top]");
  const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
  record("charcoal header bg", /rgb\(27,\s*29,\s*33\)/.test(bg), bg);

  await page.waitForSelector('[data-at-gross-flow-row="calls"], [data-at-gross-flow-row="puts"]', { timeout: 30_000 });
  await assertAtHeaderLayout(page, record);

  const dayKind = await page.locator("[data-at-day-status]").getAttribute("data-at-day-status");
  const dayText = await page.locator("[data-at-day-status]").innerText().catch(() => "");
  record("day status attribute", dayKind != null, dayKind ?? "missing");
  const dayHasPct = /DAY\s+(DOWN|UP|FLAT)/.test(dayText);
  record("DAY not bare dash when close wired", dayHasPct || dayKind === "unavailable", dayText);

  const flowNow = await page.locator("[data-at-flow-now]").innerText().catch(() => "");
  record("FLOW NOW label", /FLOW NOW/.test(flowNow), flowNow);
}

try {
  await openAt();
  await assertHeaderLayout();
  await waitForLiveLadder(page);
  const strikes = await page.locator("[data-at-strike]").count();
  record("live ladder rows", strikes > 5, String(strikes));
  const dayText = await page.locator("[data-at-day-status]").innerText().catch(() => "");
  record("no fake DAY FLAT 0", !/DAY FLAT 0\.00%/.test(dayText), dayText);
  await page.screenshot({ path: path.join(OUT, "at-header-flow-440x956.png"), fullPage: false });
  await page.screenshot({ path: path.join(OUT, "at-header-full-440x956.png"), fullPage: true });
} catch (err) {
  record("live capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "at-header-flow-report.json"), JSON.stringify({ checks, live: LIVE }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);