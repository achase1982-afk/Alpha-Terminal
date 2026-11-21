/**
 * Case (a) — Chain/Options dirty draft: 1 SELL + 1 BUY @ qty 3 survives Portfolio chunk failure.
 * WebKit 440×956, mocked Portfolio 404; exact per-leg snapshot equality (not count-only).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createChunkRetryPage,
  openChain,
  ensureMixedDraftQty3,
  chunkVerifyTargetUrl,
  ensureChunkVerifyServer,
  readChainDraftSnapshot,
  lockChainSheetLimit,
  runPortfolioChunkDetour,
} from "./lib/chunk-retry-webkit.mjs";
import { assertDraftSnapshotsExact, normalizeChainDraftSnapshot } from "./lib/chunk-retry-draft-assert.mjs";

const LIVE = chunkVerifyTargetUrl();
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-chunk-retry-draft-survival";

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
const viteChild = await ensureChunkVerifyServer();
const { browser, page, metrics, reloadNavigations } = await createChunkRetryPage(LIVE);

const blockPortfolio = { value: false };
const portfolioStatuses = [];
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (blockPortfolio.value && /PortfolioView/i.test(url)) {
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
  if (!LIVE.includes("chain-order-sheet")) {
    await openChain(page);
  } else {
    await page.waitForSelector("[data-options-chain-scroll], [data-at-root]", { timeout: 90_000 }).catch(() => undefined);
    await page.locator('[data-at-view-selector] select').first().selectOption("chain").catch(() => undefined);
    await page.waitForSelector("[data-chain-draft-strip], [data-chain-draft-leg]", { timeout: 60_000 }).catch(() => undefined);
  }
  await ensureMixedDraftQty3(page);

  const stripSnap = await readChainDraftSnapshot(page);
  const normStrip = normalizeChainDraftSnapshot(stripSnap);
  record("mixed SELL+BUY qty 3 strip", normStrip?.legs?.length === 2 && normStrip.legs.every((l) => l.qty === 3), JSON.stringify(normStrip));

  await lockChainSheetLimit(page, "1.23");

  const before = await readChainDraftSnapshot(page);
  record(
    "locked limit before detour",
    before?.sheet?.limitLocked === true && String(before?.sheet?.limitPrice ?? "").length > 0,
    JSON.stringify(before?.sheet),
  );

  const detour = await runPortfolioChunkDetour(page, {
    blockPortfolioRef: blockPortfolio,
    portfolioStatuses,
    reloadNavigations,
    metrics,
  });
  record("decline reload (0 main-frame reloads)", detour.reloadOk, String(reloadNavigations()));
  record("zero broker mutations", detour.brokerOk, String(metrics.brokerMutations));

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
    { timeout: 90_000 },
  );

  const after = await readChainDraftSnapshot(page);

  const exactErrors = assertDraftSnapshotsExact(before, after);
  record(
    "each leg contract/strike/side/expiry/qty exact",
    exactErrors.length === 0,
    exactErrors.join("; ") || JSON.stringify({ before: normalizeChainDraftSnapshot(before), after: normalizeChainDraftSnapshot(after) }),
  );
  record(
    "limit lock unchanged",
    after?.sheet?.limitLocked === before?.sheet?.limitLocked && after?.sheet?.limitPrice === before?.sheet?.limitPrice,
    JSON.stringify({ beforeSheet: before?.sheet, afterSheet: after?.sheet }),
  );
  record("zero reloads after return", reloadNavigations() === 0, String(reloadNavigations()));
  record("portfolio mocked 404", detour.portfolio404, JSON.stringify(portfolioStatuses));

  await page.screenshot({ path: path.join(OUT, "chain-draft-survival-after-return-440x956.png") });
} catch (err) {
  record("chain draft survival", false, err instanceof Error ? err.message : String(err));
}

const buildMeta = await page.evaluate(() => ({
  buildId: document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ?? "",
}));

await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify(
    {
      case: "chain-options-dirty-draft",
      viewport: "440x956-webkit",
      checks,
      live: LIVE,
      buildId: buildMeta.buildId,
      portfolioStatuses,
      brokerMutations: metrics.brokerMutations,
      mainFrameReloads: reloadNavigations(),
      chunkStatuses: metrics.chunkStatuses.slice(-20),
    },
    null,
    2,
  ),
);
await browser.close();
if (viteChild?.pid) process.kill(-viteChild.pid, "SIGTERM");
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);