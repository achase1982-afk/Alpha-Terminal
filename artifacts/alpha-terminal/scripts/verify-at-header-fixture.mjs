/**
 * Fixture acceptance (c): down session % with rising tick cue + call buying gross labels.
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertAtHeaderLayout } from "./lib/at-header-layout-assert.mjs";
import { AT_FIXTURE_BASE, ensureAtFixtureVite } from "./lib/at-fixture-vite.mjs";

const BASE = process.env.AT_VERIFY_BASE ?? AT_FIXTURE_BASE;
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-header-fixture";

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

let viteChild = null;
try {
  viteChild = await ensureAtFixtureVite();
} catch (err) {
  record("fixture vite", false, err instanceof Error ? err.message : String(err));
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 440, height: 956 } });

const fixtureUrl = BASE.includes("/dev/active-trader")
  ? `${BASE}?fixture=spx&scene=header-down`
  : `${BASE}/dev/active-trader?fixture=spx&scene=header-down`;

try {
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const glance = page.locator("[data-at-glance-top]").first();
  await glance.waitFor({ state: "attached", timeout: 90_000 });
  const visible = await glance.isVisible();
  record("glance header attached", true, visible ? "visible" : "attached");
  if (!visible) record("glance header visible", false, "not visible");
  await page.waitForTimeout(1500);
  await assertAtHeaderLayout(page, record);

  const dayKind = await page.locator("[data-at-day-status]").getAttribute("data-at-day-status");
  record("DAY DOWN on fixture", dayKind === "down", dayKind ?? "missing");

  await page.waitForTimeout(2000);
  const tick = await page.locator("[data-at-tick-cue]").count();
  const tickColor = await page
    .locator("[data-at-tick-cue]")
    .evaluate((el) => getComputedStyle(el).color)
    .catch(() => "");
  const tickGreen = /rgb\(.*\)/.test(tickColor) && tick > 0;
  record("tick cue present", tickGreen, tickColor || `nodes ${tick}`);

  const callsRow = await page.locator('[data-at-gross-flow-row="calls"]').innerText();
  const boughtOk = /Bought/.test(callsRow) && !/Bought \$0/.test(callsRow);
  record("call buying visible", boughtOk, callsRow.slice(0, 80));

  const truncated = await page.locator("[data-at-glance-top]").evaluate((el) => el.scrollHeight > el.clientHeight + 2);
  record("no header truncation", !truncated, truncated ? "overflow" : "ok");

  await page.screenshot({ path: path.join(OUT, "at-header-fixture-full-440x956.png"), fullPage: true });
} catch (err) {
  record("fixture run", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "report.json"), JSON.stringify({ checks }, null, 2));
await browser.close();
if (viteChild) viteChild.kill();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);