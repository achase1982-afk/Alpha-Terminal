import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-c5";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

async function switchView(page, value) {
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().waitFor({ state: "attached", timeout: 90_000 });
  await viewSel.first().selectOption(value);
  await page.waitForTimeout(450);
}

async function openOptions(page, height, view) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await switchView(page, view);
}

async function openOptionsAt(page, height) {
  await openOptions(page, height, "at");
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, { timeout: 90_000 });
}

async function atmCallAskStrike(page) {
  return page.evaluate(() => {
    const spot = [...document.querySelectorAll("[data-at-strike]")].find((n) => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg.includes("251") || bg.includes("rgb(251");
    });
    return spot?.getAttribute("data-at-strike") ?? null;
  });
}

let putAskRowCursor = 0;
async function clickNextPutAsk(page, force = false) {
  const panel = page.locator('[id^="options-exp-panel-"]');
  if ((await panel.count()) === 0) {
    await page.locator('[data-ui-audit="chain-exp-btn"]').first().click().catch(() => undefined);
    await page.waitForSelector('[id^="options-exp-panel-"]', { timeout: 15_000 }).catch(() => undefined);
  }
  const asks = page.locator('[id^="options-exp-panel-"] button[aria-label^="Ask"]');
  const idx = putAskRowCursor * 2 + 1;
  await asks.nth(idx).click({ timeout: 10_000, force });
  putAskRowCursor += 1;
  await page.waitForTimeout(280);
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem(
    "alpha-terminal-storage",
    JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
  );
});

async function runAtBuild(height) {
  await openOptionsAt(page, height);
  record(`view selector (${height}px)`, (await page.locator("[data-at-view-selector]").count()) > 0, "toolbar");

  const strike = await atmCallAskStrike(page);
  if (!strike) {
    record(`AT leg tray (${height}px)`, false, "no ATM");
    return;
  }

  await page.locator(`[data-at-quote="call-ask-${strike}"]`).click();
  await page.waitForTimeout(400);
  const traySlot = page.locator("[data-at-leg-tray-slot]");
  await traySlot.waitFor({ state: "visible", timeout: 10_000 });
  record(`AT leg tray (${height}px)`, (await page.locator("[data-at-leg-tray]").count()) > 0, "visible");

  const sheetCollapsed =
    (await page.getByTestId("options-chain-order-sheet").count()) === 0 ||
    (await page.locator("[data-testid='options-chain-order-sheet'] [aria-expanded='false']").count()) > 0;
  record(`sheet absent build (${height}px)`, sheetCollapsed, sheetCollapsed ? "collapsed/hidden" : "sheet visible");

  const trayY = await traySlot.boundingBox();
  const next = Number(strike) + 5;
  const bidSel = `[data-at-quote="call-bid-${next}"]`;
  if ((await page.locator(bidSel).count()) > 0) {
    await page.locator(bidSel).click();
    await page.waitForTimeout(400);
    const trayY2 = await traySlot.boundingBox();
    const stable = trayY && trayY2 && Math.abs(trayY.y - trayY2.y) < 2;
    record(`tray stable 2nd leg (${height}px)`, !!stable, stable ? "ok" : `Δy=${trayY && trayY2 ? trayY.y - trayY2.y : "?"}`);
  }

  await page.screenshot({ path: path.join(OUT, `live-at-c5-at-2leg-${height}px.png`) });
}

async function runChainRoundTrip(height) {
  putAskRowCursor = 0;
  await openOptions(page, height, "chain");
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 90_000 });
  await page.waitForSelector('[id^="options-exp-panel-"]', { timeout: 90_000 });

  const noHScroll = await page.evaluate(() => {
    const sc = document.querySelector("[data-options-chain-scroll]");
    return sc ? sc.scrollWidth <= sc.clientWidth + 2 : false;
  });
  record(`chain no horizontal scroll (${height}px)`, noHScroll, noHScroll ? "ok" : "overflow");

  const expiryBefore = await page.evaluate(() => {
    const open = document.querySelector('[data-ui-audit="chain-exp-btn"][aria-expanded="true"] span');
    return open?.textContent?.trim() ?? "";
  });

  await clickNextPutAsk(page, height <= 700);
  await clickNextPutAsk(page, height <= 700);
  const pressed = await page.locator('[id^="options-exp-panel-"] button[aria-pressed="true"]').count();
  record(`two put cells outlined (${height}px)`, pressed >= 2, `pressed=${pressed}`);

  const strip = (await page.locator("[data-chain-draft-strip]").count()) > 0;
  const sheetClosed = (await page.getByTestId("options-chain-order-sheet").count()) === 0;
  record(`chain draft strip (${height}px)`, strip && sheetClosed, strip ? "strip only" : "missing");

  await switchView(page, "at");
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  await page.locator("[data-at-leg-tray]").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  const atTray = (await page.locator("[data-at-leg-tray]").count()) > 0;
  record(`AT legs preserved (${height}px)`, atTray, atTray ? "tray" : "missing");

  const expiryPill = await page.locator("[data-at-expiry-pill]").first().innerText().catch(() => "");
  record(`expiry preserved AT (${height}px)`, expiryPill.length > 0, expiryPill || "none");

  await switchView(page, "chain");
  await page.waitForTimeout(500);
  const expiryAfter = await page.evaluate(() => {
    const open = document.querySelector('[data-ui-audit="chain-exp-btn"][aria-expanded="true"] span');
    return open?.textContent?.trim() ?? "";
  });
  record(
    `expiry round-trip (${height}px)`,
    expiryBefore && expiryAfter && expiryBefore === expiryAfter,
    `${expiryBefore} -> ${expiryAfter}`,
  );

  await page.screenshot({ path: path.join(OUT, `live-at-c5-chain-${height}px.png`) });
}

try {
  for (const height of [956, 658]) {
    await runAtBuild(height);
    await runChainRoundTrip(height);
  }
} catch (err) {
  record("c5 capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-c5-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);