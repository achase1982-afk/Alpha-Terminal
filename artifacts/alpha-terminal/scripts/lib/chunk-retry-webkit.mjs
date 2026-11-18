/** Shared WebKit 440×956 + reload/broker instrumentation for chunk recovery verifiers. */
import { webkit, devices } from "playwright";

const IPHONE = devices["iPhone 14 Pro Max"];

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
    reloadCount: 0,
    brokerMutations: 0,
    chunkStatuses: [],
    buildIds: [],
  };

  await page.addInitScript(() => {
    const orig = Location.prototype.reload;
    Location.prototype.reload = function atPatchedReload() {
      window.__AT_TEST_RELOAD_COUNT = (window.__AT_TEST_RELOAD_COUNT ?? 0) + 1;
    };
    window.__AT_TEST_RELOAD_COUNT = 0;
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
    async readReloadCount() {
      return page.evaluate(() => window.__AT_TEST_RELOAD_COUNT ?? 0);
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
}

export async function tapTwoPutAsks(page) {
  let row = 0;
  for (let i = 0; i < 2; i += 1) {
    const asks = page.locator('[id^="options-exp-panel-"] button[aria-label^="Ask"]');
    const idx = row * 2 + 1;
    await asks.nth(idx).click({ timeout: 15_000, force: true });
    row += 1;
    await page.waitForTimeout(350);
  }
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