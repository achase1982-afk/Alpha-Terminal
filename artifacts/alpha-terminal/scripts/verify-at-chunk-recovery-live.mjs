/**
 * Live 440×956: block lazy chunk, confirm scoped error + shell chrome; retry unblocks.
 */
import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-chunk-recovery-live";
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
  serviceWorkers: "block",
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
});

let blockPortfolio = true;
await page.route("**/*", (route) => {
  const url = route.request().url();
  if (blockPortfolio && /PortfolioView/i.test(url)) {
    route.abort("failed");
    return;
  }
  route.continue();
});

try {
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(800);

  await page.locator("[data-bottom-nav]").getByText("PORTFOLIO", { exact: true }).click({ timeout: 30_000 });
  await page.waitForSelector('[data-lazy-view-name="Portfolio"]', { timeout: 15_000 });
  await page.waitForTimeout(400);

  const shell = await page.evaluate(() => ({
    header: !!document.getElementById("terminal-header"),
    nav: !!document.querySelector("[data-bottom-nav]"),
    err: !!document.querySelector("[data-lazy-view-error]"),
    errName: document.querySelector("[data-lazy-view-error]")?.getAttribute("data-lazy-view-name") ?? "",
    rootEmpty: (document.getElementById("root")?.childElementCount ?? 0) < 1,
  }));
  record("scoped portfolio error", shell.err && shell.errName === "Portfolio", JSON.stringify(shell));
  record("header stays mounted", shell.header, String(shell.header));
  record("bottom nav stays mounted", shell.nav, String(shell.nav));
  record("app not fully blank", !shell.rootEmpty && shell.header, shell.rootEmpty ? "empty root" : "ok");
  await page.screenshot({ path: path.join(OUT, "portfolio-chunk-blocked-440x956.png") });

  blockPortfolio = false;
  await page.locator('[data-lazy-view-name="Portfolio"] [data-lazy-view-retry]').click({ timeout: 10_000 });
  await page.waitForTimeout(2500);
  const recovered = await page.evaluate(
    () => !document.querySelector("[data-lazy-view-error]") && document.body.innerText.length > 200,
  );
  record("retry recovers portfolio", recovered, recovered ? "ok" : "still error");

  let blockNews = true;
  await page.unroute("**/*").catch(() => undefined);
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (blockNews && /NewsTab/i.test(url)) route.abort("failed");
    else route.continue();
  });

  await page.locator("[data-bottom-nav]").getByText("MARKETS", { exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "NEWS", exact: true }).click({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  const news = await page.evaluate(() => ({
    err: !!document.querySelector('[data-lazy-view-error][data-lazy-view-name="News"]'),
    header: !!document.getElementById("terminal-header"),
  }));
  record("scoped news error", news.err, JSON.stringify(news));
  record("news shell intact", news.header, String(news.header));
  await page.screenshot({ path: path.join(OUT, "news-chunk-blocked-440x956.png") });

  blockNews = false;
  await page.locator('[data-lazy-view-name="News"] [data-lazy-view-retry]').click({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const newsOk = await page.evaluate(() => !document.querySelector('[data-lazy-view-name="News"]'));
  record("news retry", newsOk, newsOk ? "ok" : "still error");
} catch (err) {
  record("chunk recovery live", false, err instanceof Error ? err.message : String(err));
}

await writeFile(path.join(OUT, "report.json"), JSON.stringify({ checks, live: LIVE }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);