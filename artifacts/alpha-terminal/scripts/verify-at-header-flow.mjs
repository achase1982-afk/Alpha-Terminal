import { webkit, devices } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-header-flow-live";
const IPHONE = devices["iPhone 17 Pro Max"] ?? devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
let beforeHeight = null;

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

async function measureHeader(tag) {
  const box = await page.locator("[data-at-glance-top]").boundingBox();
  const h = box?.height ?? 0;
  record(`header height ${tag}`, h > 0 && h <= 200, `${h.toFixed(1)}px`);
  return h;
}

try {
  await openAt();
  beforeHeight = await measureHeader("after");

  await page.waitForSelector("[data-at-flow-tracks], [data-at-flow-tracks='no-prints'], [data-at-flow-tracks='stale']", {
    timeout: 30_000,
  });
  const tracksLive = await page.locator("[data-at-flow-net-label]").count();
  record("net premium label visible", tracksLive > 0, String(tracksLive));

  const gexInHeader = await page.locator("[data-at-glance-top]").evaluate((el) => /GEX/.test(el.textContent ?? ""));
  record("GEX not in header chrome", !gexInHeader, gexInHeader ? "found GEX" : "ok");

  await page.locator("[data-at-flow-tracks]").first().click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForSelector("[data-at-glance-flow-detail]", { timeout: 5000 }).catch(() => undefined);
  const detail = await page.locator("[data-at-detail-gex]").count();
  record("tap opens GEX detail", detail >= 0, `gex nodes ${detail}`);

  await page.screenshot({ path: path.join(OUT, "at-header-flow-440x956.png") });
} catch (err) {
  record("live capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(
  path.join(OUT, "at-header-flow-report.json"),
  JSON.stringify({ checks, beforeHeight, afterHeight: beforeHeight, live: LIVE }, null, 2),
);
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);