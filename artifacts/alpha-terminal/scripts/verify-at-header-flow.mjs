import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

async function measureHeader() {
  const box = await page.locator("[data-at-glance-top]").boundingBox();
  const h = box?.height ?? 0;
  record("header height", h > 0 && h <= 200, `${h.toFixed(1)}px`);
  return h;
}

try {
  await openAt();
  const headerH = await measureHeader();

  const bg = await page.locator("[data-at-glance-top]").evaluate((el) => getComputedStyle(el).backgroundColor);
  record("charcoal header bg", /rgb\(27,\s*29,\s*33\)/.test(bg), bg);

  await page.waitForSelector("[data-at-gross-flow], [data-at-gross-flow='no-prints'], [data-at-gross-flow='stale']", {
    timeout: 30_000,
  });
  const flowNow = await page.locator("[data-at-flow-now]").innerText().catch(() => "");
  record("FLOW NOW label", /FLOW NOW/.test(flowNow), flowNow);

  const dayStatus = await page.locator("[data-at-day-status]").count();
  record("DAY status row", dayStatus > 0, String(dayStatus));

  const grid = await page.locator("[data-at-day-levels-grid]").count();
  record("day low/high grid", grid > 0, String(grid));

  const gexInHeader = await page.locator("[data-at-glance-top]").evaluate((el) => /GEX/.test(el.textContent ?? ""));
  record("GEX not in header chrome", !gexInHeader, gexInHeader ? "found GEX" : "ok");

  const orderRow = await page.locator("[data-at-order-settings-row]").count();
  record("order settings in header", orderRow > 0, String(orderRow));

  await page.screenshot({ path: path.join(OUT, "at-header-flow-440x956.png"), fullPage: false });
  await page.screenshot({ path: path.join(OUT, "at-header-full-440x956.png"), fullPage: true });
} catch (err) {
  record("live capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(
  path.join(OUT, "at-header-flow-report.json"),
  JSON.stringify({ checks, headerH: checks.find((c) => c.name === "header height")?.detail, live: LIVE }, null, 2),
);
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);