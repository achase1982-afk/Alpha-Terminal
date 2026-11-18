import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-chain-draft";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
let placeOrderPosts = 0;
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/portfolio/place-order")) placeOrderPosts += 1;
});

await page.addInitScript(() => {
  localStorage.setItem(
    "alpha-terminal-storage",
    JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
  );
});

async function openChain(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("chain");
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 90_000 });
  await page.waitForSelector('[id^="options-exp-panel-"]', { timeout: 90_000 });
}

let putAskRowCursor = 0;
async function clickNextPutAsk(force = false) {
  const asks = page.locator('[id^="options-exp-panel-"] button[aria-label^="Ask"]');
  const idx = putAskRowCursor * 2 + 1;
  if (idx >= (await asks.count())) throw new Error("no more put ask rows");
  await asks.nth(idx).click({ timeout: 10_000, force });
  putAskRowCursor += 1;
  await page.waitForTimeout(300);
}

async function runHeight(height) {
  placeOrderPosts = 0;
  putAskRowCursor = 0;
  const tag = `${height}px`;

  await openChain(height);
  const scrollY0 = await page.evaluate(() => document.querySelector("[data-options-chain-scroll]")?.scrollTop ?? 0);
  await clickNextPutAsk(height <= 700);
  const sheetClosed = (await page.getByTestId("options-chain-order-sheet").count()) === 0;
  const strip = (await page.locator("[data-chain-draft-strip]").count()) > 0;
  const pressed = await page.locator('[id^="options-exp-panel-"] button[aria-pressed="true"]').count();
  record(`first tap no ticket (${tag})`, sheetClosed && strip, sheetClosed ? "strip only" : "sheet opened");
  record(`first cell outlined (${tag})`, pressed === 1, `pressed=${pressed}`);
  await page.screenshot({ path: path.join(OUT, `chain-draft-first-tap-${height}.png`) });

  for (let i = 0; i < 3; i += 1) await clickNextPutAsk(height <= 700);
  const legs = await page.locator("[data-chain-draft-leg]").count();
  const stillClosed = (await page.getByTestId("options-chain-order-sheet").count()) === 0;
  record(`legs 2-4 no sheet (${tag})`, legs === 4 && stillClosed, `legs=${legs}`);
  await page.screenshot({ path: path.join(OUT, `chain-draft-4-legs-${height}.png`) });

  await clickNextPutAsk(height <= 700);
  await page.waitForTimeout(400);
  const legCountAfter5 = await page.locator("[data-chain-draft-leg]").count();
  const limitMsg = (await page.locator("[data-chain-leg-limit-msg]").count()) > 0;
  record(`5th rejected (${tag})`, legCountAfter5 === 4 && limitMsg, `legs=${legCountAfter5} msg=${limitMsg}`);
  await page.screenshot({ path: path.join(OUT, `chain-draft-5th-rejected-${height}.png`) });

  await page.locator("[data-chain-draft-leg]").first().getByLabel("Remove leg").click();
  await page.waitForTimeout(300);
  await clickNextPutAsk(height <= 700);
  const legCountAfterSwap = await page.locator("[data-chain-draft-leg]").count();
  record(`remove and add (${tag})`, legCountAfterSwap === 4, `legs=${legCountAfterSwap}`);

  const scrollY1 = await page.evaluate(() => document.querySelector("[data-options-chain-scroll]")?.scrollTop ?? 0);
  record(`scroll preserved (${tag})`, Math.abs(scrollY1 - scrollY0) < 120, `${scrollY0} -> ${scrollY1}`);

  await page.getByTestId("chain-draft-next").click();
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 15_000 });
  record(`Next opens ticket (${tag})`, true, "sheet visible");
  await page.screenshot({ path: path.join(OUT, `chain-draft-next-ticket-${height}.png`) });

  record(`zero place-order POST (${tag})`, placeOrderPosts === 0, `count=${placeOrderPosts}`);
}

try {
  await runHeight(956);
  await runHeight(658);
} catch (err) {
  record("chain-draft capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-chain-draft-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);