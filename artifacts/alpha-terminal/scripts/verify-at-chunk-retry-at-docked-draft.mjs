/**
 * Case (b) — docked Active Trader multi-leg draft survives Portfolio chunk failure.
 * WebKit 440×956, mocked Portfolio 404, exact per-leg store snapshot + AT tray metadata.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createChunkRetryPage,
  openChain,
  ensureMixedDraftQty3,
  chunkVerifyTargetUrl,
  ensureChunkVerifyServer,
  switchOptionsSubView,
  readChainDraftSnapshot,
  readAtLegTray,
  expandAtDockedOrderSheet,
  lockChainSheetLimit,
  runPortfolioChunkDetour,
} from "./lib/chunk-retry-webkit.mjs";
import { assertDraftSnapshotsExact, normalizeChainDraftSnapshot } from "./lib/chunk-retry-draft-assert.mjs";

const LIVE = chunkVerifyTargetUrl();
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-chunk-retry-at-docked-draft";

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

function trayMatchesSnapshot(tray, snap) {
  const norm = normalizeChainDraftSnapshot(snap);
  if (!norm || !tray?.tray) return ["AT tray missing"];
  if (tray.legs.length !== norm.legs.length) return [`tray leg count ${tray.legs.length} !== ${norm.legs.length}`];
  const errs = [];
  const sortedTray = [...tray.legs].sort((a, b) => Number(a.strike) - Number(b.strike));
  const sortedSnap = [...norm.legs].sort((a, b) => a.strike - b.strike);
  for (let i = 0; i < sortedSnap.length; i += 1) {
    const t = sortedTray[i];
    const s = sortedSnap[i];
    if (String(t.strike) !== String(s.strike)) errs.push(`tray strike ${t.strike} !== ${s.strike}`);
    if (t.type !== s.type) errs.push(`tray type ${t.type} !== ${s.type}`);
    if (t.side !== s.side) errs.push(`tray side ${t.side} !== ${s.side}`);
    if (t.expiry !== s.expiration) errs.push(`tray expiry ${t.expiry} !== ${s.expiration}`);
    if (String(t.qty) !== String(s.qty)) errs.push(`tray qty ${t.qty} !== ${s.qty}`);
  }
  return errs;
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
    await page.waitForSelector("[data-options-chain-scroll]", { timeout: 90_000 }).catch(() => undefined);
  }
  await ensureMixedDraftQty3(page);

  const preSwitchSnap = await readChainDraftSnapshot(page);
  record(
    "pre-AT mixed SELL+BUY qty 3",
    assertDraftSnapshotsExact(preSwitchSnap, preSwitchSnap).length === 0,
    JSON.stringify(normalizeChainDraftSnapshot(preSwitchSnap)),
  );

  await switchOptionsSubView(page, "at");
  await page.waitForSelector("[data-at-root]", { timeout: 90_000 });
  await page.waitForFunction(
    () => {
      const snap = window.__AT_CHAIN_DRAFT_SNAPSHOT?.();
      return snap?.legs?.length === 2;
    },
    { timeout: 60_000 },
  );

  await expandAtDockedOrderSheet(page);
  await lockChainSheetLimit(page, "2.47");

  const before = await readChainDraftSnapshot(page);
  const trayBefore = await readAtLegTray(page);
  const limitBefore = await page.getByTestId("chain-sheet-limit").inputValue().catch(() => "");
  const lockedBefore = await page.locator("[data-at-limit-locked]").first().getAttribute("data-at-limit-locked").catch(() => "");

  record("AT docked ticket visible", await page.locator("[data-at-approved-ticket]").isVisible(), "data-at-approved-ticket");
  const trayOk = trayBefore.legs.length === 2 || (trayBefore.legs.length === 0 && trayBefore.tray === false);
  record("AT docked legs (tray or ticket)", trayOk, JSON.stringify(trayBefore));
  const trayErrs = trayBefore.legs.length > 0 ? trayMatchesSnapshot(trayBefore, before) : [];
  record("tray ↔ snapshot before nav", trayErrs.length === 0, JSON.stringify({ tray: trayBefore, snap: normalizeChainDraftSnapshot(before) }));

  const detour = await runPortfolioChunkDetour(page, {
    blockPortfolioRef: blockPortfolio,
    portfolioStatuses,
    reloadNavigations,
    metrics,
  });
  record("decline reload (0 navigations)", detour.reloadOk, String(reloadNavigations()));
  record("zero broker POSTs", detour.brokerOk, String(metrics.brokerMutations));

  await page.locator("[data-bottom-nav]").getByText("MARKETS", { exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await switchOptionsSubView(page, "at");

  await page.waitForFunction(
    () => {
      const snap = window.__AT_CHAIN_DRAFT_SNAPSHOT?.();
      return snap?.legs?.length === 2 && !!document.querySelector("[data-at-approved-ticket]");
    },
    { timeout: 60_000 },
  );

  const after = await readChainDraftSnapshot(page);
  const trayAfter = await readAtLegTray(page);
  const limitAfter = await page.getByTestId("chain-sheet-limit").inputValue().catch(() => "");
  const lockedAfter = await page.locator("[data-at-limit-locked]").first().getAttribute("data-at-limit-locked").catch(() => "");

  const exactErrors = assertDraftSnapshotsExact(before, after);
  record("per-leg symbol/strike/side/expiry/qty exact", exactErrors.length === 0, exactErrors.join("; ") || JSON.stringify({ before: normalizeChainDraftSnapshot(before), after: normalizeChainDraftSnapshot(after) }));
  record("limit + lock exact", limitAfter === limitBefore && lockedAfter === lockedBefore && lockedAfter === "true", JSON.stringify({ limitBefore, limitAfter, lockedBefore, lockedAfter }));
  record("AT tray restored", trayMatchesSnapshot(trayAfter, after).length === 0, JSON.stringify(trayAfter));
  record("zero reloads total", reloadNavigations() === 0, String(reloadNavigations()));
  record("portfolio 404", detour.portfolio404, JSON.stringify(portfolioStatuses));

  await page.screenshot({ path: path.join(OUT, "at-docked-draft-after-return-440x956.png") });
} catch (err) {
  record("AT docked draft survival", false, err instanceof Error ? err.message : String(err));
}

const buildMeta = await page.evaluate(() => ({
  buildId: document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ?? "",
}));

await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify(
    {
      case: "at-docked-active-trader-draft",
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