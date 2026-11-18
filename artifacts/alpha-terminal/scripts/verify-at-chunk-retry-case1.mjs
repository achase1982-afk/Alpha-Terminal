/**
 * Case 1 — transient chunk failure (440×956 WebKit): second network fetch succeeds on Retry.
 * Records request status codes + build id + window.__AT_CHUNK_IMPORT_LOG.
 */
import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-chunk-retry-case1";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const chunkRequests = [];

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

let portfolioFetches = 0;
page.on("request", (req) => {
  const url = req.url();
  if (/PortfolioView/i.test(url)) {
    chunkRequests.push({ phase: "request", url, method: req.method() });
  }
});
page.on("response", (res) => {
  const url = res.url();
  if (/PortfolioView/i.test(url)) {
    chunkRequests.push({ phase: "response", url, status: res.status() });
  }
});

let blockPortfolio = true;
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (blockPortfolio && /PortfolioView/i.test(url)) {
    portfolioFetches += 1;
    if (portfolioFetches === 1) {
      route.abort("failed");
      return;
    }
  }
  route.continue();
});

try {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(800);

  await page.locator("[data-bottom-nav]").getByText("PORTFOLIO", { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('[data-lazy-view-error][data-lazy-view-name="Portfolio"]', { timeout: 20_000 });

  const buildMeta = await page.evaluate(() => ({
    buildId: document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ?? window.__AT_BUILD_ID ?? "",
    log: window.__AT_CHUNK_IMPORT_LOG ?? [],
  }));
  record("build id present", !!buildMeta.buildId, buildMeta.buildId || "missing");

  blockPortfolio = false;
  await page.locator('[data-lazy-view-name="Portfolio"] [data-lazy-view-retry]').click({ timeout: 10_000 });
  await page.waitForTimeout(3500);

  const after = await page.evaluate(() => ({
    err: !!document.querySelector('[data-lazy-view-error][data-lazy-view-name="Portfolio"]'),
    log: window.__AT_CHUNK_IMPORT_LOG ?? [],
    buildId: window.__AT_BUILD_ID ?? "",
  }));

  const responses = chunkRequests.filter((r) => r.phase === "response");
  const statuses = responses.map((r) => r.status);
  const retryBust = responses.some((r) => /atRetry=/.test(r.url));
  const cacheBustLog = after.log.some((e) => e.mode === "cache-bust" && e.attempt >= 1);

  record("scoped error before retry", buildMeta.log.some((e) => !e.ok) || portfolioFetches >= 1, JSON.stringify(buildMeta.log));
  record("second portfolio fetch", portfolioFetches >= 2 || responses.length >= 2, `fetches=${portfolioFetches} responses=${responses.length}`);
  record("retry response ok", statuses.includes(200), JSON.stringify(statuses));
  record("cache-bust url on retry", retryBust || cacheBustLog, JSON.stringify({ retryBust, cacheBustLog, log: after.log }));
  record("portfolio recovered", !after.err, after.err ? "still error" : "ok");
  record("import log has retry attempt", after.log.some((e) => e.attempt >= 1), JSON.stringify(after.log));

  await page.screenshot({ path: path.join(OUT, "case1-portfolio-retry-440x956.png") });
} catch (err) {
  record("case1 chunk retry", false, err instanceof Error ? err.message : String(err));
}

await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify({ checks, live: LIVE, chunkRequests, buildId: checks.find((c) => c.name === "build id present")?.detail }, null, 2),
);
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT, chunkRequests }, null, 2));
process.exit(failed.length ? 1 : 0);