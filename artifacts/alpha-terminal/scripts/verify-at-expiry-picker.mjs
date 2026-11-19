/**
 * 440×956 WebKit: Chain ↔ AT share one selected expiry (SPX + NVDA fixtures, no orders).
 */
import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAtFixtureVite } from "./lib/at-fixture-vite.mjs";

const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/verify-at-expiry-picker";
const IPHONE = devices["iPhone 14 Pro Max"];

const CASES = [
  {
    label: "spx",
    url: "http://127.0.0.1:5173/dev/active-trader?fixture=spx&scene=expiry-picker&exp=2026-11-20",
    expA: "2026-11-19",
    expB: "2026-11-20",
    pickA: /19 NOV/i,
    pickB: /20 NOV/i,
  },
  {
    label: "nvda",
    url: "http://127.0.0.1:5173/dev/active-trader?fixture=nvda&scene=expiry-picker&exp=2026-11-21",
    expA: "2026-11-18",
    expB: "2026-11-21",
    pickA: /18 NOV/i,
    pickB: /21 NOV/i,
  },
];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
let viteChild = null;
if (!(await fetch(CASES[0].url).then((r) => r.ok).catch(() => false))) {
  viteChild = await ensureAtFixtureVite({ VITE_DEV_BYPASS_AUTH: "true", VITE_AT_GLANCE_TOP: "1" });
}

const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
});

async function runCase(page, c) {
  let placeOrderPosts = 0;
  const onReq = (req) => {
    if (req.method() === "POST" && req.url().includes("/api/portfolio/place-order")) placeOrderPosts += 1;
  };
  page.on("request", onReq);
  await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("[data-testid='at-expiry-picker']", { timeout: 60_000 });
  record(`${c.label}: picker visible`, true, "");
  const picker = page.getByTestId("at-expiry-picker");
  const initial = await picker.getAttribute("data-at-expiry-selected");
  record(`${c.label}: initial exp B`, initial === c.expB, initial ?? "");
  await picker.click();
  await page.locator('[data-radix-select-viewport] [role="option"]').filter({ hasText: c.pickA }).first().click();
  await page.waitForTimeout(700);
  const ladderExp = await page.locator("[data-at-ladder-expiration]").getAttribute("data-at-ladder-expiration");
  record(`${c.label}: AT ladder exp A`, ladderExp === c.expA, ladderExp ?? "");
  await page.locator('[data-bottom-tab="markets"]').click();
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 30_000 });
  const chainExp = await page
    .locator("[data-options-chain-selected-expiration]")
    .getAttribute("data-options-chain-selected-expiration");
  record(`${c.label}: chain exp A`, chainExp === c.expA, chainExp ?? "");
  await page.locator('[data-bottom-tab="activeTrader"]').click();
  await page.waitForSelector("[data-testid='at-expiry-picker']", { timeout: 30_000 });
  const back = await picker.getAttribute("data-at-expiry-selected");
  record(`${c.label}: round-trip exp A`, back === c.expA, back ?? "");
  await picker.click({ force: true });
  await page.waitForTimeout(200);
  await page.locator('[data-radix-select-viewport] [role="option"]').filter({ hasText: c.pickB }).first().click();
  await page.waitForTimeout(700);
  const ladderExp2 = await page.locator("[data-at-ladder-expiration]").getAttribute("data-at-ladder-expiration");
  record(`${c.label}: change to exp B`, ladderExp2 === c.expB, ladderExp2 ?? "");
  record(`${c.label}: zero broker posts`, placeOrderPosts === 0, String(placeOrderPosts));
  page.off("request", onReq);
  await page.screenshot({ path: path.join(OUT, `expiry-picker-${c.label}-440x956.png`), fullPage: true });
}

for (const c of CASES) {
  if (!(await fetch(c.url).then((r) => r.ok).catch(() => false))) {
    throw new Error(`fixture unreachable: ${c.url}`);
  }
  const page = await context.newPage();
  try {
    await runCase(page, c);
  } finally {
    await page.close();
  }
}

await browser.close();
if (viteChild) {
  try {
    process.kill(-viteChild.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
}
const failed = checks.filter((x) => !x.pass).length;
const report = { failed, checks };
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(failed > 0 ? 1 : 0);