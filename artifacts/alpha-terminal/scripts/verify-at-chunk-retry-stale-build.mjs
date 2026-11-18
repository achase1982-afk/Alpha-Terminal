/**
 * Case 2 — build A tab, stale chunk 404, single bounded reload into build B (mocked document build ids).
 * WebKit 440×956, clean tab (no draft).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createChunkRetryPage } from "./lib/chunk-retry-webkit.mjs";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-chunk-retry-stale-build";
const BUILD_A = "mock-build-A-stale";
const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
const { browser, page, metrics } = await createChunkRetryPage(LIVE);

let documentPass = 0;
let blockStaleChunk = true;
let staleChunkUrl = null;
const buildIdsSeen = [];

await page.route("**/*", async (route) => {
  const req = route.request();
  const url = req.url();
  const type = req.resourceType();

  if (type === "document" && documentPass < 2) {
    documentPass += 1;
    const res = await route.fetch();
    let html = await res.text();
    const buildId = documentPass === 1 ? BUILD_A : html.match(/name="at-build-id" content="([^"]+)"/)?.[1] ?? "build-B-live";
    buildIdsSeen.push(buildId);
    if (!html.includes('name="at-build-id"')) {
      html = html.replace("</head>", `  <meta name="at-build-id" content="${buildId}">\n</head>`);
    } else {
      html = html.replace(/name="at-build-id" content="[^"]*"/, `name="at-build-id" content="${buildId}"`);
    }
    await route.fulfill({
      status: res.status(),
      headers: { ...res.headers(), "content-type": "text/html; charset=utf-8", "x-at-build-id": buildId },
      body: html,
    });
    return;
  }

  if (blockStaleChunk && /PortfolioView/i.test(url)) {
    staleChunkUrl = staleChunkUrl ?? url.split("?")[0];
    await route.fulfill({ status: 404, contentType: "text/plain", body: "stale chunk A" });
    metrics.chunkStatuses.push({ url, status: 404 });
    return;
  }

  await route.continue();
});

try {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(800);

  const buildAfterLoad = await page.evaluate(
    () => document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ?? "",
  );
  record("build A on first document", buildAfterLoad === BUILD_A, buildAfterLoad);

  await page.locator("[data-bottom-nav]").getByText("PORTFOLIO", { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('[data-lazy-view-error][data-lazy-view-name="Portfolio"]', { timeout: 25_000 });

  await page.locator('[data-lazy-view-name="Portfolio"] [data-lazy-view-retry]').click({ timeout: 10_000 });
  await page.waitForTimeout(1200);

  const reloadOffered = await page.evaluate(() => !!document.querySelector("[data-lazy-view-reload]"));
  record("reload offered after stale chunk", reloadOffered, String(reloadOffered));

  blockStaleChunk = false;
  page.once("dialog", (d) => d.accept());
  const reloadPromise = page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => undefined);
  await page.locator("[data-lazy-view-reload]").click({ timeout: 10_000 });
  await reloadPromise;
  await page.waitForTimeout(1200);

  const reloads = await page.evaluate(() => window.__AT_TEST_RELOAD_COUNT ?? 0);
  record("single bounded reload", reloads === 1, `reloads=${reloads}`);

  const buildAfterRecovery = await page.evaluate(
    () => document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ?? "",
  );
  record("build B after reload", buildAfterRecovery && buildAfterRecovery !== BUILD_A, buildAfterRecovery);
  record("two build ids recorded", buildIdsSeen.length >= 2 && buildIdsSeen[0] === BUILD_A, JSON.stringify(buildIdsSeen));

  await page.locator("[data-bottom-nav]").getByText("PORTFOLIO", { exact: true }).click({ timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const recovered = await page.evaluate(
    () => !document.querySelector('[data-lazy-view-error][data-lazy-view-name="Portfolio"]'),
  );
  const okResponses = metrics.chunkStatuses.filter((r) => /PortfolioView/i.test(r.url) && r.status === 200);
  record("portfolio loads after recovery", recovered || okResponses.length > 0, JSON.stringify({ recovered, okResponses }));

  await page.screenshot({ path: path.join(OUT, "stale-build-recovery-440x956.png") });
} catch (err) {
  record("stale build AB", false, err instanceof Error ? err.message : String(err));
}

await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify(
    {
      checks,
      live: LIVE,
      buildIdsSeen,
      staleChunkUrl,
      reloadCount: await page.evaluate(() => window.__AT_TEST_RELOAD_COUNT ?? 0).catch(() => -1),
      chunkStatuses: metrics.chunkStatuses,
      brokerMutations: metrics.brokerMutations,
    },
    null,
    2,
  ),
);
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);