/**
 * 440×956 WebKit: chain fixture posts TRIGGER + $1.50 NET_DEBIT child (mocked broker only).
 * Run from artifacts/alpha-terminal: node scripts/verify-at-bracket-submit.mjs
 */
import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAtFixtureVite } from "./lib/at-fixture-vite.mjs";

const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/verify-at-bracket-submit";
const FIXTURE =
  process.env.AT_BRACKET_SUBMIT_URL ??
  "http://127.0.0.1:5173/dev/chain-order-sheet?scene=vertical&bracket=1";
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
    body: JSON.stringify({ orderId: "MOCK-BRACKET-1" }),
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
  const send = page.getByTestId("chain-sheet-send");
  await send.click({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  const post = captured[0];
  if (post?.body) {
    const payload = JSON.parse(post.body);
    const order = payload.order ?? {};
    record("TRIGGER parent", order.orderStrategyType === "TRIGGER", order.orderStrategyType);
    const child = order.childOrderStrategies?.[0];
    record("child NET_DEBIT", child?.orderType === "NET_DEBIT", child?.orderType);
    record("child price 1.50", child?.price === 1.5, String(child?.price));
    const ins =
      child?.orderLegCollection?.map((l) => l.instruction).join(",") ?? "";
    record(
      "both close instructions",
      ins.includes("BUY_TO_CLOSE") && ins.includes("SELL_TO_CLOSE"),
      ins,
    );
  } else {
    record("place-order captured", false, "no POST body");
  }
  await page.screenshot({ path: path.join(OUT, "bracket-submit-440x956.png"), fullPage: true });
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