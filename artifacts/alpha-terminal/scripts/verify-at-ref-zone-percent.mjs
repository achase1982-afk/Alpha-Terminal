/**
 * SPX reference zones: k=0.4% (sessionLow×(1+k), sessionHigh×(1−k)) at 440×956 WebKit.
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";
import { AT_FIXTURE_BASE, ensureAtFixtureVite } from "./lib/at-fixture-vite.mjs";

const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-ref-zone-percent";
const LIVE = process.env.AT_VERIFY_LIVE;
const TARGET = LIVE ?? `${AT_FIXTURE_BASE}?fixture=spx`;

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

let viteChild = null;
await mkdir(OUT, { recursive: true });

if (!LIVE) {
  try {
    viteChild = await ensureAtFixtureVite();
  } catch (err) {
    record("fixture vite", false, err instanceof Error ? err.message : String(err));
  }
}

const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);

if (LIVE) {
  await page.addInitScript(() => {
    localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
  });
}

try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (LIVE) {
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const viewSel = page.locator('[data-at-view-selector] select');
    await viewSel.first().selectOption("at");
  }
  await page.waitForSelector("[data-at-low-zone-ref]", { timeout: 90_000 });

  const lowRow = await page.locator("[data-at-low-zone-ref]").innerText();
  const highRow = await page.locator("[data-at-high-zone-ref]").innerText();

  record("low zone top label", /Low zone top/.test(lowRow), lowRow.trim());
  record("high zone bottom label", /High zone bottom/.test(highRow), highRow.trim());

  if (!LIVE) {
    record("fixture low zone 7317", lowRow.includes("7,317"), lowRow.trim());
    record("fixture high zone 7338.5", /7,338\.5/.test(highRow), highRow.trim());
  }

  const tip = await page.evaluate(() => {
    const el = document.querySelector("[data-at-low-zone-ref]");
    return el?.getAttribute("title") ?? "";
  });
  record("tooltip cites 0.4%", tip.includes("0.4%"), tip.slice(0, 80));

  await page.screenshot({ path: path.join(OUT, "ref-zone-percent-440x956.png"), fullPage: false });
} catch (err) {
  record("ref zone percent", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "report.json"), JSON.stringify({ checks, target: TARGET }, null, 2));
await browser.close();
if (viteChild) viteChild.kill();

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);