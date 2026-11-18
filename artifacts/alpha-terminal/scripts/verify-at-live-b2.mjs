import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/live-at-b2";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const metrics = {};

async function gammaGlance(symbol) {
  const r = await fetch(`${LIVE}/api/market/at-gamma-glance?symbol=${encodeURIComponent(symbol)}`);
  return r.json();
}

await mkdir(OUT, { recursive: true });

const spxGamma = await gammaGlance("$SPX");
metrics.spxGamma = spxGamma;
const gexB = (spxGamma.zones?.netGexUsdPer1Pct ?? 0) / 1e9;
record("SPX gamma available", !spxGamma.unavailable, JSON.stringify({ gexB, flip: spxGamma.zones?.flip, walls: [spxGamma.zones?.putWall, spxGamma.zones?.callWall] }));
record("SPX GEX ~ -14B", gexB < -10 && gexB > -20, `gexB=${gexB}`);
record("SPX flip ~7290", spxGamma.zones?.flip >= 7285 && spxGamma.zones?.flip <= 7295, String(spxGamma.zones?.flip));
record("SPX walls 7340", spxGamma.zones?.callWall === 7340 && spxGamma.zones?.putWall === 7340, String(spxGamma.zones?.callWall));

for (const sym of ["$NVDA", "$SPY", "$QQQ"]) {
  const g = await gammaGlance(sym);
  metrics[sym] = g;
  const ok = !g.unavailable && g.zones?.netGexUsdPer1Pct != null;
  record(`${sym} gamma glance`, ok, ok ? `rows=${g.rowCount}` : "unavailable");
}

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

try {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Active Trader", exact: true }).click();
  await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });
  await page
    .waitForFunction(
      () => {
        const root = document.querySelector("[data-at-glance-top]");
        const text = root?.textContent ?? "";
        return /GEX/.test(text) && !/GEX —/.test(text);
      },
      { timeout: 90_000 },
    )
    .catch(() => undefined);
  await page
    .waitForSelector("[data-at-glance-flow=\"closed\"], [data-at-glance-flow=\"live\"]", { timeout: 90_000 })
    .catch(() => undefined);

  const headerSym = await page.locator("[data-at-symbol-header]").innerText();
  metrics.headerText = headerSym;
  record("header no $SPX", !headerSym.includes("$SPX"), headerSym.slice(0, 80));

  const glanceText = await page.locator("[data-at-glance-top]").innerText();
  metrics.glanceText = glanceText;
  record("glance caption closed", /Closed.*as of/i.test(glanceText), glanceText.split("\n").slice(0, 4).join(" | "));
  record("glance GEX not +$0", !/GEX \+\$0/.test(glanceText), glanceText.match(/GEX[^\n]*/)?.[0] ?? "");

  const flowState = await page.locator("[data-at-glance-flow]").getAttribute("data-at-glance-flow").catch(() => null);
  metrics.flowState = flowState;
  record("flow closed not no-prints", flowState === "closed" || flowState === "live", String(flowState));

  await page.screenshot({ path: path.join(OUT, "live-at-b2-spx-glance-440x956@3x.png") });
} catch (err) {
  record("ui capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-b2-report.json"), JSON.stringify({ metrics, checks }, null, 2));
await browser.close();

const failed = checks.filter((c) => !c.pass).length;
console.log(JSON.stringify({ failed, checks, metrics: { spxGamma: metrics.spxGamma, flowState: metrics.flowState } }, null, 2));
process.exit(failed ? 1 : 0);