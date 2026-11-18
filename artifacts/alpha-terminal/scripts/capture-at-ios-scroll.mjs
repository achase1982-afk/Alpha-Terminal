import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

const viewports = [
  { tag: "440x956", width: 440, height: 956 },
  { tag: "390x844", width: 390, height: 844 },
];

async function waitForServer(ms = 90_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}?fixture=aapl&scene=default`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

async function startVite() {
  try {
    const { execSync } = await import("node:child_process");
    execSync("fuser -k 3000/tcp 2>/dev/null || true", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  if (await waitForServer(2500)) return null;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG_ROOT,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, BROWSER: "none", VITE_DEV_BYPASS_AUTH: "true", VITE_AT_GLANCE_TOP: "0" },
  });
  child.unref();
  if (!(await waitForServer(120_000))) {
    child.kill();
    throw new Error("Vite dev server did not become ready");
  }
  return child;
}

async function ladderMetrics(page) {
  return page.evaluate(() => {
    const ladder = document.querySelector("[data-at-ladder-scroll]");
    const chrome = document.querySelector("[data-at-key-levels]");
    const ladderRect = ladder?.getBoundingClientRect();
    const chromeRect = chrome?.getBoundingClientRect();
    return {
      ladderPx: ladderRect ? Math.round(ladderRect.height) : 0,
      chromePx: chromeRect ? Math.round(chromeRect.height) : 0,
      ladderTop: ladderRect ? Math.round(ladderRect.top) : 0,
    };
  });
}

async function runAtSuite(vp, fixture) {
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const url = `${BASE}?fixture=${fixture}&scene=default`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  await page.waitForTimeout(600);

  const prefix = `at-ios-${fixture}-${vp.tag}`;
  const topMetrics = await ladderMetrics(page);
  await page.screenshot({ path: path.join(OUT, `${prefix}-top.png`), fullPage: false });

  const spotGap = page.locator("[data-at-spot-gap]").first();
  if (await spotGap.count()) {
    await spotGap.screenshot({ path: path.join(OUT, `${prefix}-spot-marker.png`) }).catch(() => undefined);
  }
  const flipGap = page.locator("[data-at-flip-gap]").first();
  if (await flipGap.count()) {
    await flipGap.screenshot({ path: path.join(OUT, `${prefix}-flip-marker.png`) }).catch(() => undefined);
  }

  const strike = fixture === "aapl" ? "350" : "7545";
  await page
    .locator(`[data-at-quote="call-ask-${strike}"]`)
    .first()
    .click({ timeout: 15_000 })
    .catch(() => page.locator(`[data-at-strike='${strike}']`).click());
  await page.waitForSelector("[data-at-trade-action-bar]", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  const selMetrics = await ladderMetrics(page);
  await page.screenshot({ path: path.join(OUT, `${prefix}-strike-selected.png`), fullPage: false });

  console.log(
    JSON.stringify({ prefix, top: topMetrics, strikeSelected: selMetrics }),
  );

  await browser.close();
  return { top: topMetrics, strikeSelected: selMetrics };
}

async function runChainSuite(vp) {
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?fixture=spx&scene=chain`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByRole("button", { name: /Chain/i }).click();
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 60_000 });
  await page.waitForTimeout(500);
  const prefix = `chain-ios-spx-${vp.tag}`;
  await page.screenshot({ path: path.join(OUT, `${prefix}-top.png`) });
  const scroller = page.locator("[data-options-chain-scroll]");
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight * 0.45;
  });
  await page.waitForTimeout(350);
  const chainPx = await page.evaluate(() => {
    const el = document.querySelector("[data-options-chain-scroll]");
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
  });
  await page.screenshot({ path: path.join(OUT, `${prefix}-mid-scroll.png`) });
  console.log(JSON.stringify({ prefix, chainScrollPx: chainPx }));
  await browser.close();
}

async function runPortfolioSuite(vp) {
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByRole("button", { name: /PORTFOLIO/i }).click().catch(() => undefined);
  await page.waitForSelector("[data-pf-root]", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  const prefix = `portfolio-ios-${vp.tag}`;
  await page.screenshot({ path: path.join(OUT, `${prefix}-top.png`) });
  const prevented = await page.evaluate(() => {
    const inner = document.querySelector("main.app-content > .tab-inner-scroll");
    if (!inner) return { innerFound: false, guardAttached: false };
    const guardAttached = inner.getAttribute("data-pf-touch-guard") === "1";
    let passive = true;
    const seen = inner.onclick; // probe: guard uses non-passive touchmove
    const moves = [];
    const orig = EventTarget.prototype.addEventListener;
    return {
      innerFound: true,
      guardAttached,
      scrollH: inner.scrollHeight,
      clientH: inner.clientHeight,
    };
  });
  console.log(JSON.stringify({ prefix, touchGuardProbe: prevented }));
  await browser.close();
}

await mkdir(OUT, { recursive: true });
const viteChild = await startVite();

const report = { capturedAt: new Date().toISOString(), viewports: {} };

for (const vp of viewports) {
  report.viewports[vp.tag] = {
    aapl: await runAtSuite(vp, "aapl"),
    spx: await runAtSuite(vp, "spx"),
    chain: { note: "see chain-ios logs" },
  };
  await runChainSuite(vp);
  await runPortfolioSuite(vp);
}

await writeFile(path.join(OUT, "pr659-ladder-heights.json"), JSON.stringify(report, null, 2));

if (viteChild) viteChild.kill();
console.log("Wrote captures +", path.join(OUT, "pr659-ladder-heights.json"));