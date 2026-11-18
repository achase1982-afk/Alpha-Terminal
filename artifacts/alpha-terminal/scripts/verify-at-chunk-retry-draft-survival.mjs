/**
 * Case 1 — real 2-leg chain draft survives Portfolio chunk failure without reload or broker POST.
 * WebKit 440×956, mocked route (Portfolio 404), live shell.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createChunkRetryPage,
  openChain,
  tapTwoPutAsks,
  readDraftDom,
} from "./lib/chunk-retry-webkit.mjs";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-chunk-retry-draft-survival";

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
const { browser, page, metrics } = await createChunkRetryPage(LIVE);

let blockPortfolio = false;
const portfolioStatuses = [];
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (blockPortfolio && /PortfolioView/i.test(url)) {
    route.fulfill({ status: 404, contentType: "text/plain", body: "stale chunk" }).then(() => {
      portfolioStatuses.push(404);
    });
    return;
  }
  route.continue();
});

try {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(800);
  await openChain(page);
  await tapTwoPutAsks(page);

  const legsBeforeNav = await readDraftDom(page);
  record("two-leg draft strip", legsBeforeNav.legCount === 2, JSON.stringify(legsBeforeNav));

  await page.getByTestId("chain-draft-next").click({ timeout: 15_000 });
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 20_000 });
  await page.getByTestId("chain-sheet-limit").fill("1.23");
  await page.getByRole("button", { name: "Lock limit", exact: true }).click({ timeout: 10_000 });
  await page.waitForTimeout(400);

  const before = await readDraftDom(page);
  const beforeMeta = await page.evaluate(() => window.__AT_CHAIN_DRAFT_SNAPSHOT?.() ?? null);
  record("locked limit before nav", before.locked === "true" && before.limit.length > 0, JSON.stringify(before));

  blockPortfolio = true;
  await page.locator("[data-bottom-nav]").getByText("PORTFOLIO", { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('[data-lazy-view-error][data-lazy-view-name="Portfolio"]', { timeout: 25_000 });

  page.once("dialog", (d) => d.dismiss());
  await page.locator("[data-lazy-view-reload]").click({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  const reloadsMid = await page.evaluate(() => window.__AT_TEST_RELOAD_COUNT ?? 0);
  record("decline reload (zero reloads)", reloadsMid === 0, String(reloadsMid));

  blockPortfolio = false;
  await page.locator("[data-bottom-nav]").getByText("MARKETS", { exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.locator('[data-at-view-selector] select').first().selectOption("chain").catch(() => undefined);

  await page.waitForFunction(
    () => {
      const snap = window.__AT_CHAIN_DRAFT_SNAPSHOT?.();
      return snap?.legs?.length === 2;
    },
    { timeout: 45_000 },
  );

  const after = await readDraftDom(page);
  const afterMeta = await page.evaluate(() => window.__AT_CHAIN_DRAFT_SNAPSHOT?.() ?? null);

  record("draft legs restored", after.legCount === 2, JSON.stringify({ before: beforeMeta, after: afterMeta }));
  record(
    "limit lock restored",
    after.locked === "true" && after.limit === before.limit,
    JSON.stringify({ before: before.limit, after: after.limit, locked: after.locked }),
  );
  record("zero broker mutations", metrics.brokerMutations === 0, String(metrics.brokerMutations));
  const reloadsEnd = await page.evaluate(() => window.__AT_TEST_RELOAD_COUNT ?? 0);
  record("zero full page reloads", reloadsEnd === 0, String(reloadsEnd));
  record("portfolio 404 during detour", portfolioStatuses.some((s) => s === 404), JSON.stringify(portfolioStatuses));

  await page.screenshot({ path: path.join(OUT, "draft-survival-after-return-440x956.png") });
} catch (err) {
  record("draft survival", false, err instanceof Error ? err.message : String(err));
}

const buildMeta = await page.evaluate(() => ({
  buildId: document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ?? "",
}));

await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify(
    {
      checks,
      live: LIVE,
      buildId: buildMeta.buildId,
      portfolioStatuses,
      brokerMutations: metrics.brokerMutations,
      chunkStatuses: metrics.chunkStatuses.slice(-20),
    },
    null,
    2,
  ),
);
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);