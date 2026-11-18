import { chromium, webkit } from "playwright";
import { mkdir } from "node:fs/promises";
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

const fixtures = ["aapl", "spx"];

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
  if (await waitForServer(2500)) return null;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG_ROOT,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, BROWSER: "none", VITE_DEV_BYPASS_AUTH: "true" },
  });
  child.unref();
  if (!(await waitForServer(120_000))) {
    child.kill();
    throw new Error("Vite dev server did not become ready");
  }
  return child;
}

async function prep(page) {
  await page.addStyleTag({
    content: `
      nav[aria-label="Main navigation"] { display: none !important; }
      [data-testid="bottom-nav"] { display: none !important; }
      footer, [class*="BottomNav"] { display: none !important; }
      [data-ui-audit="ticker-tape"] { display: none !important; }
    `,
  });
}

async function runScrollSuite(browserType, fixture, vp) {
  const browser = await browserType.launch();
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
  await prep(page);
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  await page.waitForSelector("[data-at-strike]", { timeout: 60_000 });
  await page.waitForTimeout(800);

  const prefix = `at-ios-${fixture}-${vp.tag}`;
  await page.screenshot({ path: path.join(OUT, `${prefix}-top.png`), fullPage: false });

  const ladder = page.locator("[data-at-ladder-scroll]");
  await ladder.evaluate((el) => {
    el.scrollTop = el.scrollHeight * 0.45;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${prefix}-mid-scroll.png`), fullPage: false });

  await ladder.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${prefix}-bottom.png`), fullPage: false });

  await ladder.evaluate((el) => {
    el.scrollTop = -80;
  });
  await page.waitForTimeout(300);
  const overscroll = await ladder.evaluate((el) => el.scrollTop);
  await page.screenshot({ path: path.join(OUT, `${prefix}-overscroll-attempt.png`), fullPage: false });
  console.log(`${prefix} overscroll clamped scrollTop=${overscroll}`);

  const strike = fixture === "aapl" ? "350" : "7545";
  await page.locator(`[data-at-quote="call-ask-${strike}"]`).first().click({ timeout: 15_000 }).catch(() =>
    page.locator(`[data-at-strike='${strike}']`).click(),
  );
  await page.waitForSelector("[data-at-trade-action-bar]", { timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${prefix}-strike-selected.png`), fullPage: false });

  if (typeof page.touchscreen?.swipe === "function") {
    try {
      const box = await ladder.boundingBox();
      if (box) {
        await page.touchscreen.swipe({
          startX: box.x + box.width / 2,
          startY: box.y + box.height * 0.7,
          endX: box.x + box.width / 2,
          endY: box.y + box.height * 0.2,
        });
      }
    } catch {
      /* WebKit builds without swipe */
    }
  }

  await browser.close();
}

await mkdir(OUT, { recursive: true });
const viteChild = await startVite();

async function runChainScrollSuite(browserType, vp) {
  const browser = await browserType.launch();
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?fixture=spx&scene=chain`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await prep(page);
  await page.getByRole("button", { name: /Chain/i }).click();
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 60_000 });
  await page.waitForTimeout(600);
  const prefix = `chain-ios-spx-${vp.tag}`;
  await page.screenshot({ path: path.join(OUT, `${prefix}-top.png`) });
  const scroller = page.locator("[data-options-chain-scroll]");
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight * 0.4;
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${prefix}-mid-scroll.png`) });
  await browser.close();
}

async function runNewsScrollSuite(browserType, vp) {
  const browser = await browserType.launch();
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await prep(page);
  await page.getByRole("button", { name: /MARKETS/i }).click().catch(() => undefined);
  await page.waitForTimeout(400);
  const newsTab = page.getByRole("button", { name: /^News$/i });
  if (await newsTab.count()) await newsTab.click();
  await page.waitForTimeout(800);
  const prefix = `news-ios-${vp.tag}`;
  await page.screenshot({ path: path.join(OUT, `${prefix}-top.png`) });
  await page.evaluate(() => {
    const el = document.querySelector(".tab-inner-scroll");
    if (el) el.scrollTop = 400;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${prefix}-scrolled.png`) });
  await browser.close();
}

for (const vp of viewports) {
  for (const fixture of fixtures) {
    await runScrollSuite(webkit, fixture, vp);
  }
  await runChainScrollSuite(webkit, vp);
  await runNewsScrollSuite(webkit, vp);
}

if (viteChild) viteChild.kill();
console.log("Wrote iOS scroll captures to", OUT);