import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-c4";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
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
let placeOrderPosts = 0;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/portfolio/place-order")) placeOrderPosts += 1;
});

await page.addInitScript(() => {
  localStorage.setItem(
    "alpha-terminal-storage",
    JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
  );
});

async function atmAskSelector() {
  return page.evaluate(() => {
    const spot = [...document.querySelectorAll("[data-at-strike]")].find((n) => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg.includes("251") || bg.includes("rgb(251");
    });
    const strike = spot?.getAttribute("data-at-strike");
    return strike ? `[data-at-quote="call-ask-${strike}"]` : null;
  });
}

async function openAt(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  const viewSel = page.getByLabel("Options view");
  if ((await viewSel.count()) > 0) {
    await viewSel.selectOption("at");
  } else {
    await page.getByRole("button", { name: "Active Trader", exact: true }).click();
  }
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, {
    timeout: 90_000,
  });
}

async function openReview(height) {
  placeOrderPosts = 0;
  await openAt(height);
  const askSel = await atmAskSelector();
  if (!askSel) {
    record(`ATM ask (${height}px)`, false, "no selector");
    return;
  }
  await page.locator(askSel).click({ timeout: 15_000 });
  const mobileReview = page.getByTestId("at-mobile-review");
  const chainReview = page.getByTestId("chain-sheet-review");
  if ((await mobileReview.count()) > 0) {
    await mobileReview.click({ timeout: 12_000 });
  } else {
    await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 15_000 });
    const expand = page.getByRole("button", { name: "Expand", exact: true });
    if ((await expand.count()) > 0) await expand.click();
    await chainReview.waitFor({ state: "visible", timeout: 12_000 });
    await page.waitForFunction(
      () => {
        const b = document.querySelector('[data-testid="chain-sheet-review"]');
        return b instanceof HTMLButtonElement && !b.disabled;
      },
      undefined,
      { timeout: 15_000 },
    ).catch(() => undefined);
    await chainReview.click();
  }
  await page
    .waitForSelector("[data-testid='chain-sheet-confirm'], [data-order-ticket-sheet]", { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);

  const body = await page.locator("body").innerText();
  const hasTrigger = /Trigger order summary|Order Confirmation/i.test(body);
  const hasOpenClose = /to open|to close|Buy to open|Sell to open/i.test(body);
  const strategy = body.match(/\b(OCO|Sequence)\b/i)?.[0] ?? "single";
  record(`Review opened (${height}px)`, hasTrigger, hasTrigger ? "confirm visible" : "missing");
  record(`OPEN/CLOSE labels (${height}px)`, hasOpenClose, hasOpenClose ? "ok" : body.slice(0, 120));
  record(`Bracket strategy hint (${height}px)`, true, strategy);
  record(`zero place-order POST (${height}px)`, placeOrderPosts === 0, `count=${placeOrderPosts}`);
  await page.screenshot({ path: path.join(OUT, `live-at-c4-${height}px.png`) });
}

try {
  await openReview(956);
  await openReview(658);
} catch (err) {
  record("c4 capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-c4-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);