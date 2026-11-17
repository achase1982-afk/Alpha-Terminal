import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { installQaNetworkMocks, QA_ACCOUNT_HASH } from "./fixtures/mockNetwork.js";
import { SPX_5910_CALL_SYMBOL, SPX_ATM_CALL_SYMBOL } from "./fixtures/spxChain.js";

const OUT =
  process.env.QA_SCREENSHOT_DIR ??
  path.resolve(import.meta.dirname, "../../../docs/qa-pr-b");

const variant = process.env.QA_SNAPSHOT_VARIANT ?? "after";
const prefix = `${variant}-`;

async function seedTerminalAuth(page: Page, symbol = "SPX") {
  await page.addInitScript((init: { hash: string; symbol: string }) => {
    localStorage.setItem(
      "alpha-terminal-storage",
      JSON.stringify({
        state: {
          accessToken: "qa-mock-token",
          refreshToken: "qa-mock-refresh",
          symbol: init.symbol,
          preTradeEnabled: true,
          preTradeBlockOnRed: false,
          preTradeMaxPositionPct: 3,
          accountSize: 25_000,
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      "schwab-account-store",
      JSON.stringify({
        state: {
          orderTicketAccountHash: init.hash,
          defaultTradingAccountHash: init.hash,
          accounts: [
            {
              hashValue: init.hash,
              accountNumber: "···1234",
              type: "MARGIN",
              balances: {
                buyingPower: 12_500,
                liquidationValue: 30_000,
                cashBalance: 8_000,
                equity: 30_000,
              },
            },
          ],
        },
        version: 0,
      }),
    );
  }, { hash: QA_ACCOUNT_HASH, symbol });
}

async function shot(page: Page, baseName: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${prefix}${baseName}-${w}x${h}.png`), fullPage: false });
}

async function capturePair(page: Page, baseName: string) {
  await shot(page, baseName, 440, 956);
  await shot(page, baseName, 402, 715);
}

async function expandFirstExpiry(page: Page) {
  const expToggle = page.locator("button").filter({ hasText: /\(\d+d\)/ }).first();
  if (await expToggle.isVisible().catch(() => false)) {
    await expToggle.click();
    await page.waitForTimeout(400);
  }
}

async function mergeOptionTicks(
  page: Page,
  ticks: Array<{ key: string; bid: number; ask: number; last: number }>,
) {
  await page.waitForFunction(() => typeof window.__qaMergeOptionTick === "function", undefined, {
    timeout: 30_000,
  });
  await page.evaluate((list) => {
    for (const t of list) {
      window.__qaMergeOptionTick?.({
        key: t.key,
        bid: t.bid,
        ask: t.ask,
        last: t.last,
        bidSize: null,
        askSize: null,
        volume: null,
        openInterest: null,
        iv: null,
        delta: 0.5,
        gamma: null,
        theta: null,
        vega: null,
        mark: null,
        change: null,
        ts: Date.now(),
      });
    }
  }, ticks);
}

test.describe("QA PR B screenshots", () => {
  test("options chain — crossed ATM shows em dash", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page);
    await page.goto("/qa?screen=chain", { waitUntil: "networkidle" });
    await expect(page.getByText(/QA HARNESS/i)).toBeVisible({ timeout: 60_000 });
    await expandFirstExpiry(page);
    await capturePair(page, "chain");
  });

  test("option open — live bid/mid/ask with SPX tick rounding", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { scenario: "option-header" });
    await page.goto("/qa?screen=option-open", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Review" })).toBeVisible({ timeout: 60_000 });
    await mergeOptionTicks(page, [{ key: SPX_ATM_CALL_SYMBOL, bid: 3.76, ask: 3.8, last: 3.78 }]);
    await page.getByRole("button", { name: /^Mid/i }).first().click();
    await page.waitForTimeout(800);
    await capturePair(page, "option-open");
  });

  test("debit vertical — positive spread NBBO", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { scenario: "debit-vertical" });
    await page.goto("/qa?screen=debit-vertical", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Review" })).toBeVisible({ timeout: 60_000 });
    await mergeOptionTicks(page, [
      { key: SPX_ATM_CALL_SYMBOL, bid: 3.76, ask: 3.8, last: 3.78 },
      { key: SPX_5910_CALL_SYMBOL, bid: 1.2, ask: 1.25, last: 1.22 },
    ]);
    await page.getByRole("button", { name: /^Mid/i }).first().click();
    await page.waitForTimeout(800);
    await capturePair(page, "debit-vertical");
  });

  test("stock ticket — sub-penny mid to cents", async ({ page }) => {
    await seedTerminalAuth(page, "AAPL");
    await installQaNetworkMocks(page, { aaplStock: true });
    await page.goto("/qa?screen=stock", { waitUntil: "networkidle" });
    await expect(page.getByText("AAPL", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const midBtn = page.getByRole("button", { name: /^Mid/i }).first();
    if (await midBtn.isVisible()) await midBtn.click();
    await page.waitForTimeout(800);
    await capturePair(page, "stock");
  });

  test("review confirmation — reached with valid limit", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { scenario: "debit-vertical" });
    await page.goto("/qa?screen=debit-vertical", { waitUntil: "networkidle" });
    await mergeOptionTicks(page, [
      { key: SPX_ATM_CALL_SYMBOL, bid: 3.76, ask: 3.8, last: 3.78 },
      { key: SPX_5910_CALL_SYMBOL, bid: 1.2, ask: 1.25, last: 1.22 },
    ]);
    await page.getByRole("button", { name: /^Mid/i }).first().click();
    const review = page.getByRole("button", { name: "Review" });
    await expect(review).toBeEnabled({ timeout: 15_000 });
    await review.click();
    await expect(page.getByText("Order Confirmation")).toBeVisible({ timeout: 15_000 });
    await capturePair(page, "review");
  });

  test("FAIL blocks Review (footer + dimmed CTA)", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { scenario: "fail" });
    await page.goto("/qa?screen=option-fail", { waitUntil: "networkidle" });
    const review = page.getByRole("button", { name: "Review" });
    await expect(review).toBeVisible({ timeout: 60_000 });
    await mergeOptionTicks(page, [{ key: SPX_ATM_CALL_SYMBOL, bid: 3.8, ask: 3.2, last: 3.5 }]);
    const limitInput = page.getByPlaceholder("0.00").first();
    await limitInput.fill("3.50");
    await page.waitForTimeout(800);
    if (variant === "after") {
      await expect(page.getByText("Risk: FAIL · blocks order")).toBeVisible({ timeout: 20_000 });
      await expect(review).toBeDisabled();
    }
    await expect(limitInput).toHaveValue("3.50");
    await capturePair(page, "option-fail-review");
  });
});