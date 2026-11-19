/**
 * 440×956 WebKit: single-leg BTO bracket, TP off / 10% SL → TRIGGER + STOP @ $1.80 (mocked only).
 * Run from artifacts/alpha-terminal: node scripts/verify-at-bracket-sl-submit.mjs
 */
import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAtFixtureVite } from "./lib/at-fixture-vite.mjs";

const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/verify-at-bracket-sl-submit";
const FIXTURE =
  process.env.AT_BRACKET_SL_SUBMIT_URL ??
  "http://127.0.0.1:5173/dev/chain-order-sheet?scene=1-leg&bracket=sl";
const IPHONE = devices["iPhone 14 Pro Max"];
const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

await mkdir(OUT, { recursive: true });
let viteChild = null;
const fixtureOk = await fetch(FIXTURE).then((r) => r.ok).catch(() => false);
if (!fixtureOk) {
  viteChild = await ensureAtFixtureVite({
    VITE_AT_ORDER_SEND: "1",
    VITE_ORDERS_ALLOW_WITHOUT_AUTH: "1",
  });
  const ready = await fetch(FIXTURE).then((r) => r.ok).catch(() => false);
  if (!ready) throw new Error(`fixture unreachable: ${FIXTURE}`);
}

const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
});
const page = await context.newPage();
const captured = [];
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/portfolio/place-order")) {
    captured.push({ url: req.url(), body: req.postData() });
  }
});

await page.route("**/api/portfolio/place-order", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ orderId: "MOCK-BRACKET-SL-1" }),
  });
});

try {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 60_000 });
  record("fixture page load", true, page.url());
} catch (e) {
  record("fixture page load", false, String(e));
}

if (checks[checks.length - 1]?.pass) {
  const limit = page.getByTestId("chain-sheet-limit");
  await limit.fill("2.00", { timeout: 15_000 });
  const review = page.getByTestId("chain-sheet-review");
  await review.click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  const stopRow = page.getByText(/\$1\.80|1\.80/).first();
  record("review shows $1.80 stop", (await stopRow.count()) > 0, "stop row");
  const send = page.getByTestId("chain-sheet-send");
  await send.click({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  const post = captured[0];
  if (post?.body) {
    const payload = JSON.parse(post.body);
    const order = payload.order ?? {};
    record("TRIGGER parent", order.orderStrategyType === "TRIGGER", order.orderStrategyType);
    record("entry price 2.00", order.price === 2, String(order.price));
    const child = order.childOrderStrategies?.[0];
    record("child STOP", child?.orderType === "STOP", child?.orderType);
    record("stopPrice 1.80", child?.stopPrice === 1.8, String(child?.stopPrice));
    const ins = child?.orderLegCollection?.[0]?.instruction ?? "";
    record("SELL_TO_CLOSE child", ins === "SELL_TO_CLOSE", ins);
  } else {
    record("place-order captured", false, "no POST body");
  }
  await page.screenshot({ path: path.join(OUT, "bracket-sl-submit-440x956.png"), fullPage: true });
}

await browser.close();
if (viteChild) {
  try {
    process.kill(-viteChild.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
}
const failed = checks.filter((c) => !c.pass).length;
const report = { failed, checks, captured: captured.length };
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(failed > 0 ? 1 : 0);