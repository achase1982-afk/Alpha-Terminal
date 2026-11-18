import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-c5";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

async function switchView(page, value) {
  const viewSel = page.getByLabel("Options view");
  await viewSel.waitFor({ state: "visible", timeout: 90_000 }).catch(() => undefined);
  if ((await viewSel.count()) > 0) {
    await viewSel.selectOption(value);
    await page.waitForTimeout(400);
    return;
  }
  const label = value === "at" ? "Active Trader" : "Chain";
  await page.getByRole("button", { name: label, exact: true }).click({ timeout: 30_000 });
}

async function openOptionsAt(page, height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await switchView(page, "at");
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

async function expandChainSheetIfNeeded(page) {
  const review = page.getByTestId("chain-sheet-review");
  if ((await review.count()) > 0 && (await review.isVisible())) return;
  const collapsed = page.locator("[data-testid='options-chain-order-sheet'] [aria-expanded='false']");
  if ((await collapsed.count()) > 0) {
    const expand = page.getByRole("button", { name: "Expand", exact: true });
    if ((await expand.count()) > 0) await expand.click();
    else await collapsed.first().click();
  }
  await review.waitFor({ state: "visible", timeout: 12_000 }).catch(() => undefined);
}

async function clickPutAsks(page, count, viewportHeight) {
  const panel = page.locator('[id^="options-exp-panel-"]');
  if ((await panel.count()) === 0) {
    await page.locator('[data-ui-audit="chain-exp-btn"]').first().click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForSelector('[id^="options-exp-panel-"]', { timeout: 15_000 }).catch(() => undefined);
  }
  const asks = page.locator('[id^="options-exp-panel-"] button[aria-label^="Ask"]');
  const total = await asks.count();
  let clicked = 0;
  for (let row = 0; row < count && row * 2 + 1 < total; row += 1) {
    await asks.nth(row * 2 + 1).click({ timeout: 10_000, force: viewportHeight <= 700 });
    clicked += 1;
    await page.waitForTimeout(250);
  }
  return clicked;
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

async function runViewport(height) {
  await openOptionsAt(page, height);

  record(`view selector (${height}px)`, (await page.locator("[data-at-view-selector]").count()) > 0, "toolbar");

  const strike = await atmCallAskStrike(page);
  if (!strike) {
    record(`build mode leg tray (${height}px)`, false, "no ATM");
    return;
  }

  await page.locator(`[data-at-quote="call-ask-${strike}"]`).click();
  await page.waitForTimeout(350);
  const tray = (await page.locator("[data-at-leg-tray]").count()) > 0;
  record(`AT leg tray (${height}px)`, tray, tray ? "visible" : "missing");

  const sheetCollapsed =
    (await page.locator("[data-testid='options-chain-order-sheet'] [aria-expanded='false']").count()) > 0;
  const limitHidden = (await page.getByTestId("chain-sheet-limit").count()) === 0;
  record(`sheet collapsed build (${height}px)`, sheetCollapsed && limitHidden, sheetCollapsed ? "collapsed" : "expanded");

  const next = Number(strike) + 5;
  const bidSel = `[data-at-quote="call-bid-${next}"]`;
  if ((await page.locator(bidSel).count()) > 0) {
    const trayY = await page.locator("[data-at-leg-tray]").boundingBox().catch(() => null);
    await page.locator(bidSel).click();
    await page.waitForTimeout(300);
    const trayY2 = await page.locator("[data-at-leg-tray]").boundingBox().catch(() => null);
    const stable = trayY && trayY2 && Math.abs(trayY.y - trayY2.y) < 2;
    record(`tray stable 2nd leg (${height}px)`, !!stable, stable ? "ok" : "moved");
  }

  await page.screenshot({ path: path.join(OUT, `live-at-c5-at-${height}px.png`) });
}

async function runChainFlows(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await switchView(page, "chain");
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

  const putsClicked = await clickPutAsks(page, 2, height);
  await page.waitForTimeout(600);
  const pressed = await page.locator('[id^="options-exp-panel-"] button[aria-pressed="true"]').count();
  record(`two put cells outlined (${height}px)`, putsClicked >= 2 && pressed >= 2, `clicked=${putsClicked} pressed=${pressed}`);

  const chainTray = (await page.locator("[data-at-leg-tray]").count()) > 0;
  record(`chain leg tray (${height}px)`, chainTray, chainTray ? "visible" : "missing");

  await expandChainSheetIfNeeded(page);
  const limitVisible = (await page.getByTestId("chain-sheet-limit").isVisible().catch(() => false));
  record(`sheet expands for edit (${height}px)`, limitVisible, limitVisible ? "limit visible" : "hidden");

  await switchView(page, "at");
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  const atTray = (await page.locator("[data-at-leg-tray]").count()) > 0;
  record(`AT calls-left tray (${height}px)`, atTray, atTray ? "legs preserved" : "missing");

  const expiryPill = await page
    .locator("[data-at-expiry-pill]")
    .first()
    .innerText()
    .catch(() => "");
  record(`expiry preserved AT (${height}px)`, expiryPill.length > 0, expiryPill || "none");

  await switchView(page, "chain");
  await page.waitForTimeout(500);
  const expiryAfter = await page.evaluate(() => {
    const open = document.querySelector('[data-ui-audit="chain-exp-btn"][aria-expanded="true"] span');
    return open?.textContent?.trim() ?? "";
  });
  const sym = await page.evaluate(() => document.body.innerText.includes("SPX"));
  record(`symbol SPX (${height}px)`, sym, sym ? "ok" : "missing");
  record(
    `expiry preserved chain round-trip (${height}px)`,
    expiryBefore && expiryAfter && expiryBefore === expiryAfter,
    `${expiryBefore} -> ${expiryAfter}`,
  );

  await page.screenshot({ path: path.join(OUT, `live-at-c5-chain-${height}px.png`) });
}

try {
  await runViewport(956);
  await runViewport(658);
  await runChainFlows(956);
  await runChainFlows(658);
} catch (err) {
  record("c5 capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-c5-report.json"), JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);