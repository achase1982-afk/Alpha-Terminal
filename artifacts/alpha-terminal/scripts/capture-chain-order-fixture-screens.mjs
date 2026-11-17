import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = process.env.CHAIN_ORDER_ARTIFACT_DIR ?? "/opt/cursor/artifacts";
const BASE = process.env.CHAIN_ORDER_BASE_URL ?? "http://127.0.0.1:3000/dev/chain-order-sheet";

const scenes = [
  { name: "chain-sheet-1-leg-440x956.png", scene: "1-leg", wait: "options-chain-order-sheet" },
  { name: "chain-sheet-vertical-440x956.png", scene: "vertical", wait: "options-chain-order-sheet" },
  { name: "chain-sheet-iron-condor-440x956.png", scene: "iron-condor", wait: "options-chain-order-sheet" },
  { name: "chain-sheet-confirm-440x956.png", scene: "confirm", wait: "chain-sheet-confirm" },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

for (const { name, scene, wait } of scenes) {
  await page.goto(`${BASE}?scene=${scene}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByTestId(wait).waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForTimeout(scene === "confirm" ? 1200 : 900);
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  console.log("wrote", path.join(OUT, name));
}

await browser.close();