/**
 * Desktop metrics bar: day range shows em dash — not $0.00–$0.00 premarket.
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-desktop-day-range";

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.keyboard.press("Meta+k").catch(() => page.keyboard.press("Control+k"));
await page.getByPlaceholder(/search|symbol/i).first().fill("AAPL", { timeout: 15_000 });
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.waitForTimeout(800);

const range = await page.evaluate(() => {
  return document.querySelector('[data-ui-audit="metrics-day-range"]')?.textContent?.trim() ?? "";
});
record("metrics day range visible", range.length > 0, range || "missing");
record("not zero placeholder", !/\$0\.00.*\$0\.00/.test(range), range);
record("em dash when no session", range === "—" || /—/.test(range) || /\$[\d,.]+.*\$[\d,.]+/.test(range), range);

await page.screenshot({ path: path.join(OUT, "desktop-day-range-1280.png"), fullPage: false });
await writeFile(path.join(OUT, "report.json"), JSON.stringify({ checks, range, live: LIVE }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass).length;
console.log(JSON.stringify({ failed, checks, out: OUT }, null, 2));
process.exit(failed ? 1 : 0);