import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-steady-flow-header";
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

  const glanceTop = page.locator("[data-at-glance-top]");
  const glanceBox = await glanceTop.boundingBox();
  record(`header height (${height}px)`, glanceBox != null && glanceBox.height > 0, glanceBox?.height);

  const dayStatus = await page.locator("[data-at-day-status]").innerText().catch(() => "");
  record(`DAY status (${height}px)`, /DAY (UP|DOWN|FLAT|—)/.test(dayStatus), dayStatus.trim());

  const dayLow = await page.locator("[data-at-day-low]").innerText();
  const lowZone = await page.locator("[data-at-low-zone-slot]").innerText();
  const highZone = await page.locator("[data-at-high-zone-slot]").innerText();
  const dayHigh = await page.locator("[data-at-day-high]").innerText();
  const rowText = `${dayLow} ${lowZone} ${highZone} ${dayHigh}`;

  record(`four session values (${height}px)`, /Day low/.test(rowText) && /Low zone/.test(rowText) && /High zone/.test(rowText) && /Day high/.test(rowText), rowText.trim());

  const noZeroLevel = !/\b0\.00\b/.test(dayLow) && !/Day low 0\b/.test(dayLow);
  record(`no overnight zero (${height}px)`, noZeroLevel, dayLow.trim());

  const flowLive = await page.locator('[data-at-glance-flow="live"]').count();
  const grossRows = await page.locator("[data-at-gross-flow-row]").count();
  record(`gross flow rows (${height}px)`, flowLive > 0 && grossRows >= 2, `live=${flowLive} rows=${grossRows}`);

  const walls = await page.locator("[data-at-flow-wall]").count();
  record(`flow wall labels (${height}px)`, walls >= 2, String(walls));

  await page.screenshot({ path: path.join(OUT, `steady-flow-header-${height}px.png`) });
}

try {
  await runHeight(956);
  await runHeight(658);
} catch (err) {
  record("steady-flow capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "steady-flow-header-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);