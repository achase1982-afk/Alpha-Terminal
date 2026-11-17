import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { installQaNetworkMocks, QA_ACCOUNT_HASH, type QaMockScenario } from "./fixtures/mockNetwork.js";
import { SPX_ATM_CALL_SYMBOL } from "./fixtures/spxChain.js";

const OUT =
  process.env.QA_SCREENSHOT_DIR ??
  path.resolve(import.meta.dirname, "../../../docs/qa-pr-b");

const variant = process.env.QA_SNAPSHOT_VARIANT ?? "after";
const prefix = `${variant}-`;

async function seedTerminalAuth(page: Page) {
  await page.addInitScript((hash: string) => {
    localStorage.setItem(
      "alpha-terminal-storage",
      JSON.stringify({
        state: {
          accessToken: "qa-mock-token",
          refreshToken: "qa-mock-refresh",
          symbol: "SPX",
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
          orderTicketAccountHash: hash,
          defaultTradingAccountHash: hash,
          accounts: [
            {
              hashValue: hash,
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
  }, QA_ACCOUNT_HASH);
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
    await page.waitForTimeout(300);
  }
}

test.describe("QA PR B screenshots", () => {
  test("options chain (crossed ATM)", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page);
    await page.goto("/qa?screen=chain");
    await expect(page.getByText(/QA HARNESS/i)).toBeVisible({ timeout: 30_000 });
    await expandFirstExpiry(page);
    await page.getByText("Crossed").first().scrollIntoViewIfNeeded().catch(() => {});
    await capturePair(page, "chain");
  });

  test("option ticket — open", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { scenario: "option-header" });
    await page.goto("/qa?screen=option-open");
    await expect(page.getByRole("button", { name: "Review" })).toBeVisible({ timeout: 30_000 });
    await capturePair(page, "option-open");
  });

  test("option ticket — close", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page);
    await page.goto("/qa?screen=option-close");
    await expect(page.getByRole("button", { name: "Review" })).toBeVisible({ timeout: 30_000 });
    const limit = page.getByPlaceholder("0.00").first();
    if (await limit.isVisible()) await limit.fill("3.50");
    await capturePair(page, "option-close");
  });

  test("stock ticket", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { aaplStock: true });
    await page.goto("/qa?screen=stock");
    await expect(page.getByText("AAPL", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await capturePair(page, "stock");
  });

  test("FAIL blocks Review (footer + dimmed CTA)", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { scenario: "fail" });
    await page.goto("/qa?screen=option-fail");
    const review = page.getByRole("button", { name: "Review" });
    await expect(review).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__qaMergeOptionTick === "function", undefined, {
      timeout: 30_000,
    });
    await page.evaluate((sym) => {
      window.__qaMergeOptionTick?.({
        key: sym,
        bid: 3.8,
        ask: 3.2,
        last: 3.5,
        bidSize: null,
        askSize: null,
        volume: null,
        openInterest: null,
        iv: null,
        delta: 0.52,
        gamma: null,
        theta: null,
        vega: null,
        mark: null,
        change: null,
        ts: Date.now(),
      });
    }, SPX_ATM_CALL_SYMBOL);
    const limit = page.getByPlaceholder("0.00").first();
    if (await limit.isVisible()) await limit.fill("3.50");
    await page.waitForTimeout(500);
    if (variant === "after") {
      await expect(page.getByText("Risk: FAIL · blocks order")).toBeVisible({ timeout: 20_000 });
      await expect(review).toBeDisabled();
    }
    await capturePair(page, "option-fail-review");
  });

  test("review confirmation (BP after trade)", async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { scenario: "option-header" });
    await page.goto("/qa?screen=option-open");
    const midBtn = page.getByRole("button", { name: /^Mid/i }).first();
    if (await midBtn.isVisible().catch(() => false)) await midBtn.click();
    const review = page.getByRole("button", { name: "Review" });
    await expect(review).toBeVisible({ timeout: 30_000 });
    if (await review.isEnabled()) {
      await review.click();
      await expect(page.getByText("Order Confirmation")).toBeVisible({ timeout: 10_000 });
    }
    await capturePair(page, "review");
  });
});