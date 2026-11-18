import { test, expect, devices } from "@playwright/test";
import { futuresChainPlaceholderPrimary } from "../src/lib/futuresSchwabUi";

const base = process.env.FUTURES_ES_BASE_URL ?? "http://127.0.0.1:3000/dev/futures-es";
const outDir = process.env.FUTURES_ES_ARTIFACT_DIR ?? "/opt/cursor/artifacts";

/** WebKit mobile captures — labeled fixture at /dev/futures-es (not live Schwab). */
test.use({
  ...devices["iPhone 14"],
  browserName: "webkit",
});

type Scene =
  | { scene: "options-chain"; audit: "futures-chain-placeholder"; file: "options-es" }
  | { scene: "options-nq"; audit: "futures-chain-placeholder"; file: "options-nq" }
  | { scene: "active-trader"; audit: "at-futures-live-quote"; file: "active-trader-es" }
  | { scene: "trade-notice"; testId: "futures-trade-blocked-notice"; file: "trade-blocked-notice" };

const captures: { file: string; scene: Scene["scene"] }[] = [
  { file: "futures-options-es", scene: "options-chain" },
  { file: "futures-options-nq", scene: "options-nq" },
  { file: "futures-active-trader-es", scene: "active-trader" },
  { file: "futures-trade-blocked", scene: "trade-notice" },
];

const viewports = [
  { width: 440, height: 956 },
  { width: 390, height: 844 },
] as const;

for (const vp of viewports) {
  const suffix = `${vp.width}x${vp.height}`;
  for (const cap of captures) {
    test(`${cap.file}-${suffix}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${base}?scene=${cap.scene}`, { waitUntil: "domcontentloaded" });

      if (cap.scene === "options-chain" || cap.scene === "options-nq") {
        const placeholder = page.locator('[data-ui-audit="futures-chain-placeholder"]');
        await expect(placeholder).toBeVisible({ timeout: 45_000 });
        await expect(placeholder).toContainText(futuresChainPlaceholderPrimary());
        await expect(placeholder).not.toContainText(/unavailable/i);
        await expect(placeholder).not.toContainText(/retries/i);
        if (cap.scene === "options-nq") {
          await expect(placeholder).toHaveAttribute("data-futures-root", "NQ");
          await expect(placeholder).not.toContainText("ES and MES options");
        }
        if (cap.scene === "options-chain") {
          await expect(placeholder).toHaveAttribute("data-futures-root", "ES");
          await expect(placeholder).toContainText("ES and MES options");
        }
      }
      if (cap.scene === "active-trader") {
        await expect(page.locator('[data-ui-audit="at-futures-live-quote"]')).toBeVisible({ timeout: 45_000 });
        await expect(page.locator("[data-at-key-levels]")).toHaveCount(0);
        await expect(page.getByText("SESSION REGIME", { exact: true })).toHaveCount(0);
      }
      if (cap.scene === "trade-notice") {
        await expect(page.getByTestId("futures-trade-blocked-notice")).toBeVisible({ timeout: 45_000 });
        await expect(page.getByText("Send to Schwab")).toHaveCount(0);
      }

      await page.waitForTimeout(600);
      await page.screenshot({ path: `${outDir}/${cap.file}-${suffix}.png`, fullPage: false });
    });
  }
}