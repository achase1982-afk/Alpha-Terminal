import { test, expect } from "@playwright/test";
import path from "node:path";

const base = process.env.CHAIN_SHEET_BASE_URL ?? "http://127.0.0.1:4173";
const outDir = process.env.CHAIN_SHEET_ARTIFACT_DIR ?? "/opt/cursor/artifacts";

const shots: Array<{ name: string; query: string }> = [
  { name: "chain-sheet-1-leg-440x956", query: "scenario=1-leg" },
  { name: "chain-sheet-vertical-440x956", query: "scenario=vertical" },
  { name: "chain-sheet-iron-condor-440x956", query: "scenario=iron-condor" },
  { name: "chain-sheet-confirm-440x956", query: "scenario=vertical&confirm=1" },
];

for (const { name, query } of shots) {
  test(`screenshot ${name}`, async ({ page }) => {
    await page.goto(`${base}/dev/chain-sheet?${query}`, { waitUntil: "networkidle" });
    if (query.includes("confirm=1")) {
      await expect(page.getByTestId("chain-sheet-confirm")).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByTestId("options-chain-order-sheet")).toBeVisible();
    }
    await page.screenshot({
      path: path.join(outDir, `${name}.png`),
      fullPage: false,
    });
  });
}