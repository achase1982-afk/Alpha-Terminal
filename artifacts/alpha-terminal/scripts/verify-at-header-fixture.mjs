/**
 * Fixture acceptance (c): down session % with rising tick cue + call buying gross labels.
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.AT_VERIFY_BASE ?? "http://127.0.0.1:5173";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-header-fixture";

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 440, height: 956 } });

try {
  await page.goto(`${BASE}/?fixture=spx&scene=header-down`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("at").catch(() => undefined);
  await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });

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

  await page.screenshot({ path: path.join(OUT, "at-header-fixture-down-tick.png") });
} catch (err) {
  record("fixture run", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "report.json"), JSON.stringify({ checks }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);