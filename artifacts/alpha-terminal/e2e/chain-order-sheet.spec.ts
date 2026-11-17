import { test, expect } from "@playwright/test";

const base = process.env.CHAIN_ORDER_BASE_URL ?? "http://127.0.0.1:3000/dev/chain-order-sheet";
const outDir = process.env.CHAIN_ORDER_ARTIFACT_DIR ?? "/opt/cursor/artifacts";

const scenes = [
  { name: "chain-sheet-1-leg-440x956", scene: "1-leg" },
  { name: "chain-sheet-vertical-440x956", scene: "vertical" },
  { name: "chain-sheet-iron-condor-440x956", scene: "iron-condor" },
  { name: "chain-sheet-confirm-440x956", scene: "confirm" },
] as const;

test.describe("chain order sheet fixture screenshots", () => {
  test.use({ viewport: { width: 440, height: 956 } });

  for (const { name, scene } of scenes) {
    test(name, async ({ page }) => {
      await page.goto(`${base}?scene=${scene}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("options-chain-order-sheet")).toBeVisible({ timeout: 45_000 });
      if (scene === "confirm") {
        const confirm = page.getByTestId("chain-sheet-confirm");
        if (!(await confirm.isVisible().catch(() => false))) {
          await page.getByTestId("chain-sheet-review").click();
        }
        await expect(confirm).toBeVisible({ timeout: 15_000 });
      }
      await page.waitForTimeout(scene === "confirm" ? 1200 : 900);
      await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
    });
  }
});