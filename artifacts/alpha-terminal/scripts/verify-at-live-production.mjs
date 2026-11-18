import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = "https://alpha-terminal-production-f297.up.railway.app";
const OUT = "/opt/cursor/artifacts/live-at-verify";
const IPHONE = devices["iPhone 14 Pro Max"];

function parsePx(text) {
  const m = text?.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

async function bundleHasSubviewChrome() {
  const html = await fetch(LIVE).then((r) => r.text()).catch(() => "");
  const m = html.match(/\/assets\/index-([^.]+)\.js/);
  if (!m) return false;
  const indexJs = await fetch(`${LIVE}/assets/index-${m[1]}.js`).then((r) => r.text()).catch(() => "");
  const chunk = indexJs.match(/OptionsTab-([^.]+)\.js/)?.[0];
  if (!chunk) return false;
  const tabJs = await fetch(`${LIVE}/assets/${chunk}`).then((r) => r.text()).catch(() => "");
  return tabJs.includes("data-at-subview-chrome") && !tabJs.includes("atGlanceTopEnabled");
}

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });

// Post-merge bundle name fragment — update if chunk hash drifts after build.
let deployed = false;
for (let i = 0; i < 16; i++) {
  if (await bundleHasSubviewChrome()) {
    deployed = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 30_000));
}
record("hotfix bundle live", deployed, deployed ? "OptionsTab chunk lacks glance gate" : "timed out");

const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem(
      "alpha-terminal-storage",
      JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
    );
  } catch {
    /* ignore */
  }
});

const metrics = {};

try {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });

  const toggleVisible = await page.locator("[data-at-subview-toggle]").waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
  record("subview toggle visible", toggleVisible, String(toggleVisible));

  await page.getByRole("button", { name: "Active Trader", exact: true }).click();
  await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });

  const glanceBox = await page.locator("[data-at-glance-top]").boundingBox();
  metrics.glanceTopHeightPx = glanceBox?.height ?? null;
  record("glance top present", glanceBox != null, `height=${metrics.glanceTopHeightPx}px`);

  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, { timeout: 90_000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(OUT, "live-at-ladder-no-sheet-440x956@3x.png"), fullPage: false });

  const chromeBottom = await page.evaluate(() => {
    const g = document.querySelector("[data-at-glance-top]");
    const h = document.querySelector("[data-at-symbol-header]");
    return Math.max(g?.getBoundingClientRect().bottom ?? 0, h?.getBoundingClientRect().bottom ?? 0);
  });
  const ladderTop = await page.locator("[data-at-ladder-scroll]").boundingBox();
  const gapPx = ladderTop ? ladderTop.y - chromeBottom : null;
  metrics.chromeToLadderGapPx = gapPx;
  record("no large empty gap", gapPx == null || gapPx < 120, `gap=${gapPx}px`);

  const invalidZeroBids = await page.evaluate(() => {
    let invalid = 0;
    for (const bid of document.querySelectorAll("[data-at-quote]")) {
      if (bid.textContent?.trim() !== "0.00") continue;
      const key = bid.getAttribute("data-at-quote");
      if (!key || !key.includes("bid")) continue;
      const askKey = key.replace("bid", "ask");
      const ask = document.querySelector(`[data-at-quote="${askKey}"]`);
      const askN = parseFloat(String(ask?.textContent ?? "").replace(/[^\d.]/g, ""));
      if (!(askN > 0)) invalid += 1;
    }
    return invalid;
  });
  record("ladder zero bids have positive ask", invalidZeroBids === 0, `invalid=${invalidZeroBids}`);

  const ladderStrikeCount = await page.locator("[data-at-strike]").count();
  metrics.ladderStrikeCount = ladderStrikeCount;
  record("ladder shows many strikes", ladderStrikeCount >= 25, `strikes=${ladderStrikeCount}`);

  const yellowStrikes = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-at-strike]")];
    const spot = nodes.filter((n) => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg.includes("251") || bg.includes("rgb(251");
    });
    return { total: nodes.length, yellow: spot.length };
  });
  metrics.strikeYellowCount = yellowStrikes.yellow;
  record("only ATM strike yellow", yellowStrikes.yellow <= 1, JSON.stringify(yellowStrikes));

  const atmQuote = await page.evaluate(() => {
    const spot = [...document.querySelectorAll("[data-at-strike]")].find((n) => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg.includes("251") || bg.includes("rgb(251");
    });
    if (!spot) return null;
    const strike = spot.getAttribute("data-at-strike");
    const ask = document.querySelector(`[data-at-quote="call-ask-${strike}"]`)?.textContent?.trim();
    const bid = document.querySelector(`[data-at-quote="call-bid-${strike}"]`)?.textContent?.trim();
    return { strike, bid, ask };
  });
  metrics.atmQuote = atmQuote;
  record(
    "ATM call quotes readable",
    atmQuote != null && atmQuote.ask !== "0.00" && atmQuote.ask !== "—",
    JSON.stringify(atmQuote),
  );

  if (atmQuote?.strike) {
    await page.locator(`[data-at-quote="call-ask-${atmQuote.strike}"]`).click({ timeout: 15_000 });
    await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 20_000 });
    await page.screenshot({ path: path.join(OUT, "live-at-1leg-peek-440x956@3x.png") });

    const limit1 = await page.locator("[data-testid='chain-sheet-limit']").inputValue().catch(() => "");
    metrics.limit1Leg = limit1;

    const nextStrike = Number(atmQuote.strike) + 5;
    const sellSel = `[data-at-quote="call-bid-${nextStrike}"]`;
    const hasNext = await page.locator(sellSel).count();
    if (hasNext > 0) {
      await page.locator(sellSel).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, "live-at-2leg-peek-440x956@3x.png") });

      const sheetText = await page.locator("[data-testid='options-chain-order-sheet']").innerText();
      const limit2 = await page.locator("[data-testid='chain-sheet-limit']").inputValue().catch(() => "");
      metrics.limit2Leg = limit2;
      record("2-leg spread limit hydrated", limit2.trim().length > 0 && Number(limit2) > 0, limit2 || "empty");

      const reviewBtn = page.getByRole("button", { name: /Review/i });
      const reviewLabel = (await reviewBtn.textContent())?.trim() ?? "";
      const reviewDisabled = await reviewBtn.isDisabled();
      metrics.reviewLabel = reviewLabel;
      record("Review (sending off) disabled", reviewDisabled && /sending off/i.test(reviewLabel), reviewLabel);

      const deltaLine = sheetText.match(/Δ\s+([^\s]+)/)?.[1] ?? "";
      record("greeks sane", !deltaLine.includes("999") && deltaLine !== "", `Δ=${deltaLine}`);

      await page.getByRole("button", { name: "Expand" }).click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, "live-at-2leg-expanded-440x956@3x.png") });
    }
  }
} catch (err) {
  record("run completed", false, err instanceof Error ? err.message : String(err));
  await page.screenshot({ path: path.join(OUT, "live-at-failure.png") }).catch(() => undefined);
}

await writeFile(path.join(OUT, "live-at-verify-report.json"), JSON.stringify({ metrics, checks, live: LIVE }, null, 2));
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ mergeCheck: deployed, metrics, checks, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);