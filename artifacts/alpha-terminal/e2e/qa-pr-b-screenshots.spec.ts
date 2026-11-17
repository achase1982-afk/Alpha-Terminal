import { test, expect } from "@playwright/test";
import path from "node:path";
import { installQaNetworkMocks } from "./fixtures/mockNetwork.js";

const OUT =
  process.env.QA_SCREENSHOT_DIR ??
  path.resolve(import.meta.dirname, "../../../docs/qa-pr-b");

const variant = process.env.QA_SNAPSHOT_VARIANT ?? "after";
const prefix = `${variant}-`;

async function seedTerminalAuth(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const payload = {
      state: {
        accessToken: "qa-mock-token",
        refreshToken: "qa-mock-refresh",
        symbol: "SPX",
        preTradeEnabled: true,
        preTradeBlockOnRed: false,
        accountSize: 30_000,
      },
      version: 0,
    };
    localStorage.setItem("alpha-terminal-storage", JSON.stringify(payload));
  });
}

async function shot(page: import("@playwright/test").Page, name: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
}

test.describe("QA PR B real UI screenshots", () => {
  test.beforeEach(async ({ page }) => {
    await seedTerminalAuth(page);
    await installQaNetworkMocks(page, { symbol: "SPX" });
  });

  test("options chain sticky header", async ({ page }) => {
    await page.goto("/qa");
    await expect(page.getByText(/QA HARNESS/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/SPX/i).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, `${prefix}chain-440x956.png`, 440, 956);
    await shot(page, `${prefix}chain-402x715.png`, 402, 715);
  });

  test("order ticket review flow", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation").or(page.locator('[data-testid="bottom-nav"]')).first()).toBeVisible({
      timeout: 45_000,
    }).catch(async () => {
      await page.goto("/qa");
    });

    const tradeBtn = page.getByRole("button", { name: /trade|order/i }).first();
    if (await tradeBtn.isVisible().catch(() => false)) {
      await tradeBtn.click();
    }

    const limit = page.getByPlaceholder("0.00").first();
    if (await limit.isVisible().catch(() => false)) {
      await limit.fill("1.15");
      const review = page.getByRole("button", { name: "Review" });
      if (await review.isEnabled().catch(() => false)) {
        await review.click();
        await expect(page.getByText("Order Confirmation")).toBeVisible({ timeout: 10_000 });
      }
    }

    await shot(page, `${prefix}ticket-440x956.png`, 440, 956);
    await shot(page, `${prefix}ticket-402x715.png`, 402, 715);

    const confirmVisible = await page.getByText("Order Confirmation").isVisible().catch(() => false);
    if (confirmVisible) {
      await shot(page, `${prefix}confirm-440x956.png`, 440, 956);
      await shot(page, `${prefix}confirm-402x715.png`, 402, 715);
    }
  });
});