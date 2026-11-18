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

async function openChain() {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const viewSel = page.getByLabel("Options view");
  if ((await viewSel.count()) > 0) await viewSel.selectOption("chain");
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 90_000 });
  await page.waitForSelector('[id^="options-exp-panel-"]', { timeout: 90_000 });
}

let putAskRowCursor = 0;
async function clickNextPutAsk() {
  const asks = page.locator('[id^="options-exp-panel-"] button[aria-label^="Ask"]');
  const idx = putAskRowCursor * 2 + 1;
  if (idx >= (await asks.count())) throw new Error("no more put ask rows");
  await asks.nth(idx).click({ timeout: 10_000, force: true });
  putAskRowCursor += 1;
  await page.waitForTimeout(300);
}

try {
  placeOrderPosts = 0;
  await openChain();
  const scrollY0 = await page.evaluate(() => document.querySelector("[data-options-chain-scroll]")?.scrollTop ?? 0);
  await clickNextPutAsk();
  const sheetClosed = (await page.getByTestId("options-chain-order-sheet").count()) === 0;
  const strip = (await page.locator("[data-chain-draft-strip]").count()) > 0;
  const pressed = await page.locator('button[aria-pressed="true"]').count();
  record("first tap no ticket", sheetClosed && strip, sheetClosed ? "strip only" : "sheet opened");
  record("first cell outlined", pressed === 1, `pressed=${pressed}`);
  await page.screenshot({ path: path.join(OUT, "chain-draft-first-tap-956.png") });

  for (let i = 0; i < 3; i += 1) await clickNextPutAsk();
  const legs = await page.locator("[data-chain-draft-leg]").count();
  const stillClosed = (await page.getByTestId("options-chain-order-sheet").count()) === 0;
  record("legs 2-4 no sheet", legs >= 4 && stillClosed, `legs=${legs}`);
  await page.screenshot({ path: path.join(OUT, "chain-draft-4-legs-956.png") });

  await clickNextPutAsk();
  await page.waitForTimeout(400);
  const legCountAfter5 = await page.locator("[data-chain-draft-leg]").count();
  const limitMsg = (await page.locator("[data-chain-leg-limit-msg]").count()) > 0;
  record("5th rejected", legCountAfter5 === 4 && limitMsg, `legs=${legCountAfter5} msg=${limitMsg}`);
  await page.screenshot({ path: path.join(OUT, "chain-draft-5th-rejected-956.png") });

  await page.locator("[data-chain-draft-leg]").first().getByLabel("Remove leg").click();
  await page.waitForTimeout(300);
  await clickNextPutAsk();
  const legCountAfterSwap = await page.locator("[data-chain-draft-leg]").count();
  record("remove and add", legCountAfterSwap === 4, `legs=${legCountAfterSwap}`);

  const scrollY1 = await page.evaluate(() => document.querySelector("[data-options-chain-scroll]")?.scrollTop ?? 0);
  record("scroll preserved (~)", Math.abs(scrollY1 - scrollY0) < 120, `${scrollY0} -> ${scrollY1}`);

  await page.getByTestId("chain-draft-next").click();
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 15_000 });
  record("Next opens ticket", true, "sheet visible");
  await page.screenshot({ path: path.join(OUT, "chain-draft-next-ticket-956.png") });

  record("zero place-order POST", placeOrderPosts === 0, `count=${placeOrderPosts}`);
} catch (err) {
  record("chain-draft capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-chain-draft-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);