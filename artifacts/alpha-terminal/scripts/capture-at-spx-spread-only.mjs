import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

async function startVite() {
  try {
    execSync("pkill -f 'vite --host 127.0.0.1 --port 3000' || true", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 500));
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_DEV_BYPASS_AUTH: "true",
      VITE_AT_GLANCE_TOP: "1",
      VITE_AT_ORDER_SEND: "0",
    },
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}?fixture=spx`).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

const tap = (page, sel) => page.locator(`[data-at-quote="${sel}"]`).click({ timeout: 15_000 });

await mkdir(OUT, { recursive: true });
const vite = await startVite();
const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);

await page.goto(`${BASE}?fixture=spx`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });

await tap(page, "call-ask-7545");
await tap(page, "call-bid-7550");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, "at-phase-a-spx-2leg-440x956@3x.png") });

await page.locator("button", { hasText: "CLEAR" }).click();
await page.waitForTimeout(300);
await tap(page, "put-bid-7530");
await tap(page, "put-ask-7520");
await tap(page, "call-bid-7550");
await tap(page, "call-ask-7555");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, "at-phase-a-spx-4leg-440x956@3x.png") });

await page.locator("[data-testid='options-chain-order-sheet']").click();
await page.waitForTimeout(200);
const limit4 = await page.locator("[data-testid='chain-sheet-limit']").inputValue();
const reviewDisabled = await page.locator("[data-testid='chain-sheet-review']").isDisabled();
const sheetText = await page.locator("[data-testid='options-chain-order-sheet']").innerText();

await browser.close();
vite.kill();
console.log(
  JSON.stringify(
    {
      twoLegLimit: "see 2leg png",
      fourLegLimit: limit4,
      reviewDisabled,
      has370: /370/.test(sheetText),
      has130: /130/.test(sheetText),
    },
    null,
    2,
  ),
);