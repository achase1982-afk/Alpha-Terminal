import { test, expect, devices } from "@playwright/test";

const base = process.env.FUTURES_ES_BASE_URL ?? "http://127.0.0.1:3000/dev/futures-es";
const outDir = process.env.FUTURES_ES_ARTIFACT_DIR ?? "/opt/cursor/artifacts";

/** WebKit mobile captures — fixture labeled /ES in registerFuturesEsFixture. */
test.use({
  ...devices["iPhone 14"],
  browserName: "webkit",
});

async function shot(page: import("@playwright/test").Page, scene: string, auditOrTestId: { audit?: string; testId?: string }) {
  await page.goto(`${base}?scene=${scene}&fixture=1`, { waitUntil: "domcontentloaded" });
  if (auditOrTestId.audit) {
    await expect(page.locator(`[data-ui-audit="${auditOrTestId.audit}"]`)).toBeVisible({ timeout: 45_000 });
  }
  if (auditOrTestId.testId) {
    await expect(page.getByTestId(auditOrTestId.testId)).toBeVisible({ timeout: 45_000 });
  }
  await page.waitForTimeout(900);
}

test("futures-es-options-chain-440x956", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await shot(page, "options-chain", { audit: "futures-chain-placeholder" });
  await page.screenshot({ path: `${outDir}/futures-es-options-chain-440x956.png`, fullPage: false });
});

test("futures-es-options-chain-390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "options-chain", { audit: "futures-chain-placeholder" });
  await page.screenshot({ path: `${outDir}/futures-es-options-chain-390x844.png`, fullPage: false });
});

test("futures-es-active-trader-440x956", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await shot(page, "active-trader", { audit: "at-futures-live-quote" });
  await page.screenshot({ path: `${outDir}/futures-es-active-trader-440x956.png`, fullPage: false });
});

test("futures-es-active-trader-390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "active-trader", { audit: "at-futures-live-quote" });
  await page.screenshot({ path: `${outDir}/futures-es-active-trader-390x844.png`, fullPage: false });
});

test("futures-es-ticket-blocked-440x956", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await shot(page, "ticket-confirm", { testId: "futures-order-blocked" });
  await page.screenshot({ path: `${outDir}/futures-es-ticket-blocked-440x956.png`, fullPage: false });
});

test("futures-es-ticket-blocked-390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "ticket-confirm", { testId: "futures-order-blocked" });
  await page.screenshot({ path: `${outDir}/futures-es-ticket-blocked-390x844.png`, fullPage: false });
});