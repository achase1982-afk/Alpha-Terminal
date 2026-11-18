import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-day-low";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

function parseRgb(s) {
  const m = s?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([r, g, b]) {
  const f = (x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
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

async function runHeight(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(900);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("at").catch(() => undefined);
  await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });
  await page.waitForSelector("[data-at-day-levels-grid], [data-at-day-low]", { timeout: 90_000 });

  const dayLowRow = await page.locator("[data-at-day-low]").innerText();
  const lowZoneRef = await page.locator("[data-at-low-zone-ref]").innerText();
  const dayHighRow = await page.locator("[data-at-day-high]").innerText().catch(() => "");
  const flowRow = (await page.locator("[data-at-glance-flow-row]").count()) > 0;

  const noZeroLevel = !/\b0\.00\b/.test(dayLowRow) && !/Day low 0\b/.test(dayLowRow);
  record(`no overnight zero (${height}px)`, noZeroLevel, dayLowRow.trim());

  const dayLowOk = /Day low|Prev low/.test(dayLowRow);
  record(`day low label (${height}px)`, dayLowOk, dayLowRow.trim());

  const zoneOk = /Low zone top/.test(lowZoneRef) && (lowZoneRef.includes("—") || /\d/.test(lowZoneRef));
  record(`low zone top (${height}px)`, zoneOk, lowZoneRef.trim());

  const highOk = /Day high/.test(dayHighRow) || /High zone bottom/.test(await page.locator("[data-at-high-zone-ref]").innerText().catch(() => ""));
  record(`day high / high zone (${height}px)`, highOk, dayHighRow.trim());

  record(`gross flow row (${height}px)`, flowRow, flowRow ? "ok" : "missing");

  const contrast = await page.evaluate(() => {
    const el = document.querySelector("[data-at-low-zone-ref]");
    if (!el) return null;
    return getComputedStyle(el).color;
  });
  const fg = parseRgb(contrast);
  const ratio = fg ? contrastRatio(fg, [0, 0, 0]) : 0;
  record(`zone WCAG on black (${height}px)`, ratio >= 4.5, ratio ? ratio.toFixed(2) : "n/a");

  if (lowZoneRef.includes("–")) {
    await page.getByRole("button", { name: "Low zone reference info" }).click();
    const tip = await page.locator("[data-at-low-zone-tooltip]").innerText();
    const tipOk = tip.includes("0.4%") && tip.includes("not a forecast");
    record(`tooltip (${height}px)`, tipOk, tip.slice(0, 72));
  }

  await page.screenshot({ path: path.join(OUT, `live-at-day-low-${height}px.png`) });
}

try {
  await runHeight(956);
  await runHeight(658);
} catch (err) {
  record("day-low capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-day-low-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);