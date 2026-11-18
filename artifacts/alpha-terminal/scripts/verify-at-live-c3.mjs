import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-c3";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const metrics = {};

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

async function runFlow(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Active Trader", exact: true }).click();
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, {
    timeout: 90_000,
  });

  const atmQuote = await page.evaluate(() => {
    const spot = [...document.querySelectorAll("[data-at-strike]")].find((n) => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg.includes("251") || bg.includes("rgb(251");
    });
    if (!spot) return null;
    const strike = spot.getAttribute("data-at-strike");
    return { strike };
  });

  if (!atmQuote?.strike) {
    record(`spread ladder ATM (${height}px)`, false, "no ATM strike");
    return;
  }

  await page.locator(`[data-at-quote="call-ask-${atmQuote.strike}"]`).click({ timeout: 15_000 });
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 20_000 });

  let spreadStrike = Number(atmQuote.strike) + 5;
  for (const delta of [5, 10, -5, 15, 20]) {
    const alt = Number(atmQuote.strike) + delta;
    const sel = `[data-at-quote="call-bid-${alt}"]`;
    if ((await page.locator(sel).count()) > 0) {
      spreadStrike = alt;
      break;
    }
  }
  const spreadBidSel = `[data-at-quote="call-bid-${spreadStrike}"]`;
  if ((await page.locator(spreadBidSel).count()) === 0) {
    record(`spread second leg (${height}px)`, false, "no eligible bid strike");
    record(`spread verify hard-fail (${height}px)`, false, "no spread leg");
    return;
  }

  const aria1 = await page.locator(spreadBidSel).getAttribute("aria-label");
  record(
    `quote aria-label (${height}px)`,
    !!aria1 && /strike|call|sell|bid/i.test(aria1),
    aria1 ?? "missing",
  );

  if (height <= 658) {
    const header = page.locator("[data-testid='options-chain-order-sheet'] [aria-expanded='true']");
    if ((await header.count()) > 0) {
      await header.click();
      await page.waitForTimeout(400);
    }
    const addLeg = page.locator("[data-at-collapsed-action-bar] button", { hasText: "+ Leg" });
    const addLegVisible = (await addLeg.count()) > 0 && (await addLeg.first().isVisible());
    record(`+Leg tappable collapsed (${height}px)`, addLegVisible, `visible=${addLegVisible}`);
    if (addLegVisible) {
      await addLeg.first().click();
      await page.waitForTimeout(500);
      const legCount = await page.locator("[data-testid='options-chain-order-sheet']").innerText();
      record(`+Leg adds from collapsed (${height}px)`, /2\s*legs?/i.test(legCount), legCount.slice(0, 80));
    } else {
      await page.locator(spreadBidSel).click();
    }
  } else {
    await page.locator(spreadBidSel).click();
  }

  await page.waitForTimeout(600);
  const sheetText = await page.locator("[data-testid='options-chain-order-sheet']").innerText();
  const limit2 = await page.locator("[data-testid='chain-sheet-limit']").inputValue().catch(() => "");
  record(
    `spread BUY+SELL (${height}px)`,
    /BUY/i.test(sheetText) && /SELL/i.test(sheetText),
    `limit=${limit2}`,
  );
  record(
    `spread limit (${height}px)`,
    limit2.trim().length > 0 && Number(limit2) > 0,
    limit2 || "empty",
  );

  const expand = page.getByRole("button", { name: "Expand", exact: true });
  if ((await expand.count()) > 0) {
    await expand.click();
    await page.waitForTimeout(350);
  }

  const reviewBtn = page.locator("[data-testid='chain-sheet-review']");
  await reviewBtn.waitFor({ state: "visible", timeout: 12_000 });
  const reviewDisabled = await reviewBtn.isDisabled();
  record(`Review enabled (${height}px)`, !reviewDisabled, (await reviewBtn.textContent()) ?? "");
  if (reviewDisabled) {
    record(`hard-fail review (${height}px)`, false, "Review disabled");
  }

  await page.screenshot({ path: path.join(OUT, `live-at-c3-${height}px.png`) });
}

try {
  await runFlow(956);
  await runFlow(658);
  metrics.out = OUT;
} catch (err) {
  record("ui capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-c3-report.json"), JSON.stringify({ metrics, checks, live: LIVE }, null, 2));
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, metrics }, null, 2));
process.exit(failed.length ? 1 : 0);