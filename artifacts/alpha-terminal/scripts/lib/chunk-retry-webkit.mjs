/** Shared WebKit 440×956 + reload/broker instrumentation for chunk recovery verifiers. */
import { webkit, devices } from "playwright";
import { ensureAtFixtureVite, AT_FIXTURE_BASE } from "./at-fixture-vite.mjs";

const IPHONE = devices["iPhone 14 Pro Max"];

const PRODUCTION_LIVE = "https://alpha-terminal-production-f297.up.railway.app";

export function chunkVerifyTargetUrl() {
  if (process.env.AT_VERIFY_LIVE) return process.env.AT_VERIFY_LIVE;
  if (process.env.AT_VERIFY_CHAIN_FIXTURE === "1" || process.env.AT_VERIFY_USE_FIXTURE === "1") {
    const origin = new URL(AT_FIXTURE_BASE).origin;
    return `${origin}/dev/chain-order-sheet?scene=vertical`;
  }
  return PRODUCTION_LIVE;
}

export async function ensureChunkVerifyServer() {
  if (process.env.AT_VERIFY_CHAIN_FIXTURE === "1" || process.env.AT_VERIFY_USE_FIXTURE === "1") {
    const origin = new URL(AT_FIXTURE_BASE).origin;
    const probe = `${origin}/dev/chain-order-sheet?scene=vertical&confirm=1`;
    let child = null;
    try {
      child = await ensureAtFixtureVite({
        VITE_DEV_BYPASS_AUTH: "true",
        VITE_AUTH_DISABLED: "true",
        VITE_AT_ORDER_SEND: "0",
      });
    } catch {
      /* ensureAtFixtureVite probes /dev/active-trader; chain fixture may still be warming */
    }
    for (let i = 0; i < 120; i++) {
      if (await fetch(probe).then((r) => r.ok).catch(() => false)) return child;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("chunk fixture vite timeout (chain-order-sheet)");
  }
  return null;
}

export async function createChunkRetryPage(liveUrl) {
  const browser = await webkit.launch();
  const context = await browser.newContext({
    ...IPHONE,
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    serviceWorkers: "block",
  });
  const page = await context.newPage();

  const metrics = {
    mainFrameNavigations: 0,
    brokerMutations: 0,
    chunkStatuses: [],
    buildIds: [],
  };

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) metrics.mainFrameNavigations += 1;
  });

  page.on("request", (req) => {
    const url = req.url();
    if (req.method() === "POST" && /\/api\/portfolio\/(place-order|preview)/i.test(url)) {
      metrics.brokerMutations += 1;
    }
  });
  page.on("response", (res) => {
    const url = res.url();
    if (/PortfolioView|NewsTab|OptionsTab|index-/i.test(url)) {
      metrics.chunkStatuses.push({ url, status: res.status() });
    }
    if (url.endsWith("/") || url.includes("index.html")) {
      const bid = res.headers()["x-at-build-id"];
      if (bid) metrics.buildIds.push(bid);
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      "alpha-terminal-storage",
      JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
    );
  });

  return {
    browser,
    context,
    page,
    metrics,
    reloadNavigations() {
      return Math.max(0, metrics.mainFrameNavigations - 1);
    },
    async readBuildMeta() {
      return page.evaluate(() => ({
        buildId:
          document.querySelector('meta[name="at-build-id"]')?.getAttribute("content") ??
          window.__AT_BUILD_ID ??
          "",
        log: window.__AT_CHUNK_IMPORT_LOG ?? [],
        draft: window.__AT_CHAIN_DRAFT_SNAPSHOT?.() ?? null,
      }));
    },
    liveUrl,
  };
}

export async function openChain(page) {
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("chain");
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 90_000 });
  await page.waitForSelector('[id^="options-exp-panel-"]', { timeout: 90_000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[id^="options-exp-panel-"] button[aria-label^="Ask"]').length >= 6,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(300);
}

export async function tapTwoPutAsks(page) {
  await buildMixedSellBuyDraft(page, { targetQty: 1 });
}

/** One BUY (ask) + one SELL (bid) put, then bump each leg to targetQty (default 3). */
export async function buildMixedSellBuyDraft(page, { targetQty = 3 } = {}) {
  const pick = await page.evaluate(() => {
    const priced = (el) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ");
      return /\d/.test(text) && !text.includes("—");
    };
    const asks = [...document.querySelectorAll('[id^="options-exp-panel-"] button[aria-label^="Ask"]')].filter(priced);
    const bids = [...document.querySelectorAll('[id^="options-exp-panel-"] button[aria-label^="Bid"]')].filter(priced);
    const strikeFrom = (el) => {
      const m = (el.getAttribute("aria-label") ?? "").match(/strike\s+([\d.]+)/i);
      return m ? m[1] : "";
    };
    const askBtn = asks[1] ?? asks[0];
    const askStrike = askBtn ? strikeFrom(askBtn) : "";
    const bidBtn = bids.find((b) => strikeFrom(b) && strikeFrom(b) !== askStrike) ?? bids[3] ?? bids[0];
    return {
      askCount: asks.length,
      bidCount: bids.length,
      askStrike,
      bidStrike: bidBtn ? strikeFrom(bidBtn) : "",
    };
  });
  if (pick.askCount < 2 || pick.bidCount < 2) {
    throw new Error(`chain quotes not ready (asks=${pick.askCount} bids=${pick.bidCount})`);
  }

  const askStrike = pick.askStrike;
  const bidStrike = pick.bidStrike;
  async function pointerTap(locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("missing cell box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(30);
    await page.mouse.up();
  }

  if (askStrike) {
    await page
      .locator(`[id^="options-exp-panel-"] button[aria-label^="Ask"][aria-label*="strike ${askStrike}"]`)
      .first()
      .click({ timeout: 20_000, force: true });
    await page.waitForTimeout(450);
    await page.waitForFunction(() => document.querySelectorAll("[data-chain-draft-leg]").length >= 1, { timeout: 15_000 }).catch(() => undefined);
  }
  const bidStrikes = await page.evaluate((avoid) => {
    const priced = (el) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ");
      return /\d/.test(text) && !text.includes("—");
    };
    const bids = [...document.querySelectorAll('[id^="options-exp-panel-"] button[aria-label^="Bid"]')].filter(priced);
    return bids
      .map((el) => {
        const m = (el.getAttribute("aria-label") ?? "").match(/strike\s+([\d.]+)/i);
        return m ? m[1] : "";
      })
      .filter((s) => s && s !== avoid);
  }, askStrike);

  for (const st of [bidStrike, ...bidStrikes].filter(Boolean).slice(0, 10)) {
    if ((await page.locator("[data-chain-draft-leg]").count()) >= 2) break;
    const bidLoc = page
      .locator(`[id^="options-exp-panel-"] button[aria-label^="Bid"][aria-label*="strike ${st}"]`)
      .first();
    if (!(await bidLoc.count())) continue;
    await bidLoc.click({ timeout: 10_000, force: true }).catch(() => pointerTap(bidLoc).catch(() => undefined));
    await page.waitForTimeout(400);
  }

  let legCount = await page.locator("[data-chain-draft-leg]").count();
  if (legCount < 2) {
    const ask = page.locator('[id^="options-exp-panel-"] button[aria-label^="Ask"]');
    const bid = page.locator('[id^="options-exp-panel-"] button[aria-label^="Bid"]');
    await ask.nth(4).click({ timeout: 15_000, force: true });
    await page.waitForTimeout(350);
    await bid.nth(8).click({ timeout: 15_000, force: true });
    await page.waitForTimeout(500);
    legCount = await page.locator("[data-chain-draft-leg]").count();
  }
  if (legCount < 2) throw new Error(`expected >=2 legs (1 BUY + 1 SELL), got ${legCount} (ask=${pick.askStrike} bid=${pick.bidStrike})`);
}

export async function bumpChainDraftQty(page, targetQty = 3) {
  const incBtns = page.getByRole("button", { name: "Increase quantity" });
  const n = await incBtns.count();
  for (let i = 0; i < n; i += 1) {
    const inc = incBtns.nth(i);
    let qty = 1;
    for (let step = 0; step < 12 && qty < targetQty; step += 1) {
      await inc.click({ timeout: 5_000, force: true });
      await page.waitForTimeout(80);
      qty = await page.evaluate((idx) => {
        const snap = window.__AT_CHAIN_DRAFT_SNAPSHOT?.();
        const key = snap?.legs?.[idx]?.key;
        return key ? Number(snap.legQuantities?.[key] ?? 1) : 1;
      }, i);
    }
  }

  const sides = await page.evaluate(() =>
    [...document.querySelectorAll("[data-chain-draft-leg]")].map((el) => ({
      buySell: (el.textContent ?? "").includes("Buy") ? "Buy" : (el.textContent ?? "").includes("Sell") ? "Sell" : "",
    })),
  );
  const buys = sides.filter((s) => s.buySell === "Buy").length;
  const sells = sides.filter((s) => s.buySell === "Sell").length;
  if (buys !== 1 || sells !== 1) {
    throw new Error(`expected 1 Buy + 1 Sell, got buys=${buys} sells=${sells}`);
  }
}

export async function ensureMixedDraftQty3(page) {
  await page.waitForSelector("[data-chain-draft-leg]", { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  let legCount = await page.locator("[data-chain-draft-leg]").count();
  if (legCount < 2) {
    const snapLegs = await page.evaluate(() => window.__AT_CHAIN_DRAFT_SNAPSHOT?.()?.legs?.length ?? 0);
    if (snapLegs < 2) {
      await buildMixedSellBuyDraft(page, { targetQty: 3 });
      return;
    }
  }
  const bumpedUi = await bumpChainDraftQty(page, 3).then(() => true).catch(() => false);
  if (!bumpedUi || process.env.AT_VERIFY_CHAIN_FIXTURE === "1") {
    await page.evaluate((qty) => window.__AT_CHAIN_DRAFT_TEST_SET_QTY?.(qty), 3);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(
    () => {
      const snap = window.__AT_CHAIN_DRAFT_SNAPSHOT?.();
      if (!snap?.legs?.length) return false;
      return snap.legs.every((l) => (snap.legQuantities?.[l.key] ?? 1) >= 3);
    },
    { timeout: 20_000 },
  );
}

export async function switchOptionsSubView(page, value) {
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption(value, { timeout: 30_000 });
  await page.waitForTimeout(600);
}

export async function readChainDraftSnapshot(page) {
  return page.evaluate(() => window.__AT_CHAIN_DRAFT_SNAPSHOT?.() ?? null);
}

export async function readAtLegTray(page) {
  return page.evaluate(() => {
    const tray = document.querySelector("[data-at-leg-tray]");
    if (!tray) return { legs: [], tray: false };
    const legs = [...tray.querySelectorAll("[data-at-leg]")].map((el) => ({
      strike: el.getAttribute("data-at-leg-strike") ?? "",
      type: el.getAttribute("data-at-leg-type") ?? "",
      side: el.getAttribute("data-at-leg-side") ?? "",
      expiry: el.getAttribute("data-at-leg-expiry") ?? "",
      qty: el.getAttribute("data-at-leg-qty") ?? "",
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    }));
    return { legs, tray: true };
  });
}

export async function expandAtDockedOrderSheet(page) {
  const ticket = page.locator("[data-at-approved-ticket]");
  await ticket.waitFor({ state: "attached", timeout: 45_000 });
  const collapsed = await ticket.locator("[aria-expanded='false']").first().isVisible().catch(() => false);
  if (collapsed) {
    await ticket.locator("button").first().click({ timeout: 10_000 });
    await page.waitForTimeout(400);
  }
}

export async function openChainOrderSheetIfNeeded(page) {
  const sheetOpen = await page.locator("[data-testid='options-chain-order-sheet']").count();
  if (sheetOpen > 0) return;
  await page.getByTestId("chain-draft-next").click({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 20_000 }).catch(() => undefined);
}

export async function lockChainSheetLimit(page, limit = "1.23") {
  await openChainOrderSheetIfNeeded(page);
  if (process.env.AT_VERIFY_CHAIN_FIXTURE === "1" || process.env.AT_VERIFY_USE_FIXTURE === "1") {
    await page.evaluate(
      (p) => window.__AT_CHAIN_DRAFT_TEST_SET_SHEET?.({ limitPrice: p, limitLocked: true }),
      limit,
    );
    await page.waitForTimeout(200);
    return;
  }
  await page.getByTestId("chain-sheet-limit").fill(limit, { timeout: 20_000 });
  const lock = page
    .getByRole("button", { name: /Lock limit/i })
    .or(page.getByRole("button", { name: /Lock limit to send/i }))
    .or(page.locator('[aria-label="Lock limit"]'));
  await lock.first().click({ timeout: 15_000 });
  await page.waitForTimeout(350);
}

export async function runPortfolioChunkDetour(page, { blockPortfolioRef, portfolioStatuses, reloadNavigations, metrics }) {
  blockPortfolioRef.value = true;
  await page.locator("[data-bottom-nav]").getByText("PORTFOLIO", { exact: true }).click({ timeout: 30_000, force: true });
  await page.waitForSelector('[data-lazy-view-error][data-lazy-view-name="Portfolio"]', { timeout: 25_000 });

  page.once("dialog", (d) => d.dismiss());
  await page.locator("[data-lazy-view-reload]").click({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  const reloadOk = reloadNavigations() === 0;
  blockPortfolioRef.value = false;
  return { reloadOk, portfolio404: portfolioStatuses.some((s) => s === 404), brokerOk: metrics.brokerMutations === 0 };
}

export async function readDraftDom(page) {
  return page.evaluate(() => {
    const legs = [...document.querySelectorAll("[data-chain-draft-leg]")].map((el) => {
      const strike = el.querySelector(".tabular-nums")?.textContent?.trim() ?? "";
      const type = (el.textContent ?? "").includes(" C ") ? "CALL" : (el.textContent ?? "").includes(" P ") ? "PUT" : "";
      const buySell = (el.textContent ?? "").includes("Buy") ? "Buy" : (el.textContent ?? "").includes("Sell") ? "Sell" : "";
      const qty = el.querySelectorAll(".tabular-nums")[1]?.textContent?.trim() ?? "1";
      return { strike, type, buySell, qty, raw: (el.textContent ?? "").replace(/\s+/g, " ").trim() };
    });
    const limit = document.querySelector("[data-testid='chain-sheet-limit']")?.value ?? "";
    const locked = document.querySelector("[data-at-limit-locked]")?.getAttribute("data-at-limit-locked") ?? "";
    const strip = document.querySelector("[data-chain-draft-strip]") != null;
    const sheet = document.querySelector("[data-testid='options-chain-order-sheet']") != null;
    const draftApi = window.__AT_CHAIN_DRAFT_SNAPSHOT?.() ?? null;
    return { legs, legCount: legs.length, limit, locked, strip, sheet, draftApi };
  });
}