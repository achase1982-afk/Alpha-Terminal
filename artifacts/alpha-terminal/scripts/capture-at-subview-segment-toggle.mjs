/**
 * Anthony — Chain | AT segmented toggle captures at 440×956 WebKit (before Chain / after AT).
 */
import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";
import { AT_FIXTURE_BASE, ensureAtFixtureVite, waitForLiveLadder } from "./lib/at-fixture-vite.mjs";

const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-subview-segment-toggle";
const LIVE = process.env.AT_VERIFY_LIVE;
const FIXTURE = `${new URL(AT_FIXTURE_BASE).origin}/dev/chain-order-sheet?scene=1-leg`;
const TARGET = LIVE ?? FIXTURE;

await mkdir(OUT, { recursive: true });
let viteChild = null;
if (!LIVE) {
  viteChild = await ensureAtFixtureVite();
}

const browser = await webkit.launch();
const page = await (await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
})).newPage();
await installSafeAreaInsets(page);

await page.addInitScript(() => {
  try {
    localStorage.setItem(
      "alpha-terminal-storage",
      JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
    );
    sessionStorage.setItem("alpha_session_tab", "markets");
  } catch {
    /* ignore */
  }
});
await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 90_000 }).catch(() => undefined);
await page.waitForSelector("[data-at-subview-toggle]", { timeout: 120_000 });
await page.waitForTimeout(400);

if (TARGET.includes("127.0.0.1:5173") && !TARGET.includes("/dev/active-trader")) {
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 }).catch(() => undefined);
  await page.waitForSelector("[data-at-subview-toggle]", { timeout: 60_000 });
}

const onChain = await page.locator('[data-at-subview-value="chain"]').first().isVisible().catch(() => false);
if (!onChain) {
  await page.locator("[data-at-subview-hit]").first().click({ force: true });
  await page.waitForTimeout(400);
}

await page.screenshot({ path: path.join(OUT, "subview-toggle-chain-440x956.png"), fullPage: false });

const hit = page.locator("[data-at-subview-hit]").first();
const box = await hit.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
} else {
  await toggle.click({ force: true });
}
if (!LIVE) await waitForLiveLadder(page);
await page.waitForSelector('[data-at-subview-value="at"]', { timeout: 60_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, "subview-toggle-at-440x956.png"), fullPage: false });

const metrics = await page.evaluate(() => {
  const visual = document.querySelector("[data-at-subview-toggle]");
  const hit = document.querySelector("[data-at-subview-hit]");
  const chrome = document.querySelector("[data-at-subview-chrome]");
  const header = document.querySelector("[data-at-glance-top]");
  const chain = document.querySelector("[data-options-chain-scroll]");
  const vr = visual?.getBoundingClientRect();
  const hitR = hit?.getBoundingClientRect();
  const cr = chrome?.getBoundingClientRect();
  const hr = header?.getBoundingClientRect();
  return {
    visual: vr ? { w: vr.width, h: vr.height, right: vr.right } : null,
    hit: hitR ? { w: hitR.width, h: hitR.height } : null,
    layout: cr ? { w: cr.width, h: cr.height } : null,
    overlapHeader: vr && hr ? vr.bottom > hr.top && vr.top < hr.bottom && vr.right > hr.left : false,
    hasChainScroll: !!chain,
    noSelectChevron: !document.querySelector("[data-at-subview-toggle] svg"),
  };
});

console.log(JSON.stringify({ out: OUT, target: TARGET, metrics }, null, 2));
await browser.close();
if (viteChild?.pid) process.kill(-viteChild.pid, "SIGTERM");