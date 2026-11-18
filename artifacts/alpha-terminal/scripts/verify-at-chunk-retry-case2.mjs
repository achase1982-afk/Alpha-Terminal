/**
 * Case 2 — stale build-A chunk (404): bounded reload offer; dirty draft blocks silent reload.
 */
import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-chunk-retry-case2";
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
  serviceWorkers: "block",
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
});

const staleStatuses = [];
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (/PortfolioView/i.test(url)) {
    route.fulfill({ status: 404, contentType: "text/plain", body: "stale chunk" }).then(() => {
      staleStatuses.push(404);
    });
    return;
  }
  route.continue();
});

let reloadCalls = 0;
await page.addInitScript(() => {
  Location.prototype.reload = function patchedReload() {
    window.__AT_TEST_RELOAD_COUNT = (window.__AT_TEST_RELOAD_COUNT ?? 0) + 1;
  };
  window.__AT_TEST_RELOAD_COUNT = 0;
});

try {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    const strip = document.createElement("div");
    strip.setAttribute("data-chain-draft-strip", "1");
    document.body.appendChild(strip);
  });

  await page.locator("[data-bottom-nav]").getByText("PORTFOLIO", { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('[data-lazy-view-error][data-lazy-view-name="Portfolio"]', { timeout: 20_000 });

  const buildId = await page.evaluate(
    () => document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ?? "",
  );
  record("stale chunk 404", staleStatuses.length >= 1, JSON.stringify(staleStatuses));
  record("build id captured", !!buildId, buildId || "missing");

  await page.locator('[data-lazy-view-name="Portfolio"] [data-lazy-view-retry]').click({ timeout: 10_000 });
  await page.waitForTimeout(2500);

  const afterRetry = await page.evaluate(() => ({
    reloadOffer: !!document.querySelector("[data-lazy-view-reload]"),
    unsavedHint: !!document.querySelector("[data-lazy-view-unsaved-hint]"),
    reloadCount: window.__AT_TEST_RELOAD_COUNT ?? 0,
    log: window.__AT_CHUNK_IMPORT_LOG ?? [],
  }));

  record("reload app offered after stale retry", afterRetry.reloadOffer, String(afterRetry.reloadOffer));
  record("unsaved draft blocks auto reload", afterRetry.reloadCount === 0, `reloads=${afterRetry.reloadCount}`);
  record("unsaved hint visible", afterRetry.unsavedHint, String(afterRetry.unsavedHint));

  page.once("dialog", (d) => d.dismiss());
  await page.locator("[data-lazy-view-reload]").click({ timeout: 10_000 });
  await page.waitForTimeout(300);

  const afterDismiss = await page.evaluate(() => window.__AT_TEST_RELOAD_COUNT ?? 0);
  record("dismiss confirm keeps draft (no reload)", afterDismiss === 0, String(afterDismiss));

  await page.screenshot({ path: path.join(OUT, "case2-stale-draft-safe-440x956.png") });
} catch (err) {
  record("case2 stale chunk", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "report.json"), JSON.stringify({ checks, live: LIVE, staleStatuses }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);