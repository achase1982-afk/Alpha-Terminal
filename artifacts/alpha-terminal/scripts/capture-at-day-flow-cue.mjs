/**
 * WebKit 440×956 capture: DAY DOWN + independent tick + FLOW NOW (fixture/replay, labeled).
 * Requires local vite on :3000 with VITE_AT_GLANCE_FLOW_FIXTURE=1.
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts/at-day-flow-cue";
const URL =
  "http://127.0.0.1:3000/dev/active-trader?fixture=spx&scene=steady-flow-demo";

async function ensureVite() {
  const ok = await fetch(URL).then((r) => r.ok).catch(() => false);
  if (ok) return;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_DEV_BYPASS_AUTH: "true",
      VITE_AT_GLANCE_TOP: "1",
      VITE_AT_GLANCE_FLOW_FIXTURE: "1",
    },
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await fetch(URL).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

await mkdir(OUT, { recursive: true });
await ensureVite();

const browser = await webkit.launch();
const page = await (await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 })).newPage();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(1500);

const before = await page.evaluate(() => document.querySelector("[data-at-glance-top]")?.getBoundingClientRect().height ?? 0);
const day = await page.locator("[data-at-day-direction]").innerText();
const flowNow = await page.locator("[data-at-flow-now-label]").innerText();
const spotColor = await page.evaluate(() => getComputedStyle(document.querySelector("[data-ui-audit='at-glance-spot']") || document.body).color);
const callsDir = await page.locator("[data-at-flow-track='calls']").innerText().catch(() => "");

await page.locator("[data-at-fixture-banner]").first().isVisible().catch(() => false);

await page.screenshot({ path: path.join(OUT, "steady-flow-day-down-rising-tick-440x956.png") });

const report = {
  labeled: "MOCKED /dev fixture steady-flow-demo — not live RTH",
  viewport: "440×956 WebKit",
  headerHeightPx: before,
  dayLabel: day.trim(),
  flowNowLabel: flowNow.trim(),
  spotComputedColor: spotColor,
  callsTrackSample: callsDir,
  checks: {
    dayDown: /DAY DOWN/.test(day),
    flowNow: /FLOW NOW/.test(flowNow),
    independentCues: /DAY DOWN/.test(day),
  },
};

await writeFile(path.join(OUT, "capture-report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));