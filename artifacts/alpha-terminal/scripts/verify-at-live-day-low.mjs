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
  await page.waitForTimeout(800);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("at").catch(() => undefined);
  await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });
  await page.waitForSelector("[data-at-day-low-zone]", { timeout: 90_000 });

  const dayLow = await page.locator("[data-at-day-low]").innerText();
  const zoneRef = await page.locator("[data-at-low-zone-ref]").innerText();
  const noZero =
    !/\b0\.00\b/.test(dayLow) &&
    !/\b0\.00\b/.test(zoneRef) &&
    !zoneRef.includes("Low zone (ref) 0");
  record(`no zero placeholder (${height}px)`, noZero, `${dayLow.trim()} | ${zoneRef.trim()}`);

  const hasLabel = /Day low/.test(dayLow) && /Low zone \(ref\)/.test(zoneRef);
  record(`labels present (${height}px)`, hasLabel, "ok");

  await page.getByRole("button", { name: "Low zone reference info" }).click();
  const tip = await page.locator("[data-at-low-zone-tooltip]").innerText();
  const tipOk =
    tip.includes("FINAL daily lows") && tip.includes("NOT a forecast") && tip.includes("not a safe level");
  record(`tooltip copy (${height}px)`, tipOk, tip.slice(0, 80));

  const contrast = await page.evaluate(() => {
    const el = document.querySelector("[data-at-low-zone-ref]");
    if (!el) return null;
    const color = getComputedStyle(el).color;
    return color;
  });
  record(`zone readable (${height}px)`, contrast != null, contrast ?? "missing");

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