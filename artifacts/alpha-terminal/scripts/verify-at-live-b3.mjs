import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/live-at-b3";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const metrics = {};

async function optionsChain(symbol) {
  const r = await fetch(`${LIVE}/api/market/options?symbol=${encodeURIComponent(symbol)}`);
  return r.json();
}

await mkdir(OUT, { recursive: true });

const chain = await optionsChain("SPX");
metrics.optionsExpiries = (chain.calls ?? [])
  .map((c) => c.expiration)
  .filter((v, i, a) => a.indexOf(v) === i)
  .slice(0, 5);

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
  await page.waitForSelector("[data-at-symbol-header]", { timeout: 60_000 });

  const headerSym = await page.locator("[data-at-symbol-header]").innerText();
  metrics.headerText = headerSym;
  record(
    "header no fake zero change",
    !/\$0\.00 \(0\.00%\)/.test(headerSym),
    headerSym.split("\n").slice(0, 3).join(" | "),
  );

  const pillLabel = await page.locator("[data-at-symbol-header] [data-radix-select-trigger]").innerText().catch(
    () => page.locator("[data-at-symbol-header]").innerText(),
  );
  metrics.pillLabel = pillLabel;
  record("AT pill not expired", !/-\s*1D|·\s*-1D/i.test(pillLabel), pillLabel);
  record("AT pill shows 0D or live expiry", /0D|18\s*NOV/i.test(pillLabel), pillLabel);

  await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });
  const glanceText = await page.locator("[data-at-glance-top]").innerText();
  metrics.glanceText = glanceText.slice(0, 120);
  record("glance not OPEN 0.00", !/▲0\.00\s*OPEN/.test(glanceText), metrics.glanceText);

  await page.screenshot({ path: path.join(OUT, "live-at-b3-spx-440x956@3x.png") });
} catch (err) {
  record("ui capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "live-at-b3-report.json"), JSON.stringify({ metrics, checks }, null, 2));
await browser.close();

const failed = checks.filter((c) => !c.pass).length;
console.log(JSON.stringify({ failed, checks, metrics }, null, 2));
process.exit(failed ? 1 : 0);