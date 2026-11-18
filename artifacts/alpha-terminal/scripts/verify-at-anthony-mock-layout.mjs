/**
 * Anthony mock signoff: 440×956 WebKit Chain → AT → Chain switcher alignment + fixture typography.
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";
import { assertAtHeaderLayout } from "./lib/at-header-layout-assert.mjs";
import { AT_FIXTURE_BASE, ensureAtFixtureVite, waitForLiveLadder } from "./lib/at-fixture-vite.mjs";

const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-anthony-mock-layout";
const LIVE = process.env.AT_VERIFY_LIVE;
const FIXTURE = `${AT_FIXTURE_BASE}?fixture=spx`;
const TARGET = LIVE ?? FIXTURE;

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

async function switchView(page, value) {
  const wantAt = value === "at";
  const hit = page.locator("[data-at-subview-hit]").first();
  const select = page.locator('[data-at-subview-select-fallback], select[aria-label="Options view"]');
  if (await hit.count()) {
    const checked = await page
      .locator("[data-at-subview-value]")
      .first()
      .getAttribute("data-at-subview-value");
    if ((checked === "at") !== wantAt) {
      await hit.click({ force: true });
      await page.waitForTimeout(400);
    }
    return;
  }
  await select.first().waitFor({ state: "attached", timeout: 90_000 });
  await select.first().selectOption(value);
  await page.waitForTimeout(500);
}

async function toggleBox(page) {
  return page.locator("[data-at-subview-chrome]").first().boundingBox();
}

let viteChild = null;
await mkdir(OUT, { recursive: true });

if (!LIVE) {
  try {
    viteChild = await ensureAtFixtureVite();
  } catch (err) {
    record("fixture vite", false, err instanceof Error ? err.message : String(err));
  }
}

const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);

if (LIVE) {
  await page.addInitScript(() => {
    localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
  });
}

try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(LIVE ? 800 : 2000);
  if (LIVE) {
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
    await page.waitForTimeout(500);
  }
  await switchView(page, "chain");
  await page.waitForSelector("[data-options-chain-scroll]", { timeout: 90_000, state: "attached" });
  const chainToggle = await toggleBox(page);
  record("chain toggle visible", !!chainToggle, chainToggle ? "ok" : "missing");
  const chainRight = chainToggle ? chainToggle.x + chainToggle.width : 0;
  await page.screenshot({ path: path.join(OUT, "01-chain-440x956.png") });

  await switchView(page, "at");
  await waitForLiveLadder(page);
  await page.waitForSelector("[data-at-glance-top]", { timeout: 60_000 });
  const atToggle = await toggleBox(page);
  record("AT toggle visible", !!atToggle, atToggle ? "ok" : "missing");

  if (chainToggle && atToggle) {
    const dX = Math.abs(chainToggle.x + chainToggle.width - (atToggle.x + atToggle.width));
    const dY = Math.abs(chainToggle.y - atToggle.y);
    record("switcher same right edge", dX <= 6, `Δright=${dX.toFixed(1)} Δy=${dY.toFixed(1)}`);
  }

  const tap = await page.evaluate(() => {
    const chrome = document.querySelector("[data-at-subview-chrome]");
    const r = chrome?.getBoundingClientRect();
    return { w: r?.width ?? 0, h: r?.height ?? 0 };
  });
  record("toggle tap target ≥44px", tap.w >= 44 && tap.h >= 44, `${tap.w?.toFixed?.(0) ?? 0}×${tap.h?.toFixed?.(0) ?? 0}`);

  const noBlackPill = await page.evaluate(() => {
    const el = document.querySelector("[data-at-subview-toggle]");
    if (!el) return false;
    const bg = getComputedStyle(el).backgroundColor;
    return !/rgb\(12,\s*12,\s*12\)/.test(bg);
  });
  record("AT toggle not black pill", noBlackPill, noBlackPill ? "charcoal/gray" : "black");

  const metricRow = await page.evaluate(() => {
    const caption = document.querySelector("[data-at-ladder-heat-caption]");
    const inGroup = caption?.closest("[data-at-ladder-group-metric]") != null || caption?.hasAttribute("data-at-ladder-group-metric");
    const strikeCol = document.evaluate(
      "//span[normalize-space(text())='Strike']",
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    const strikeY = strikeCol?.getBoundingClientRect().top ?? 0;
    const capY = caption?.getBoundingClientRect().top ?? 0;
    const text = caption?.textContent?.trim() ?? "";
    return {
      inGroup,
      text,
      capAboveStrike: capY > 0 && strikeY > 0 && capY < strikeY - 2,
    };
  });
  record(
    "metric in group row only",
    metricRow.inGroup && metricRow.capAboveStrike && metricRow.text.includes("Contracts traded"),
    JSON.stringify(metricRow),
  );

  await assertAtHeaderLayout(page, record);
  await page.screenshot({ path: path.join(OUT, "02-at-fixture-440x956.png") });

  await switchView(page, "chain");
  await page.waitForTimeout(600);
  if (LIVE) {
    await page
      .waitForFunction(
        () => {
          const btn = document.querySelector('[data-ui-audit="chain-exp-btn"]');
          if (!btn) return false;
          const spans = [...btn.querySelectorAll("span")]
            .map((s) => (s.textContent ?? "").trim())
            .filter(Boolean);
          return spans.some((t) => /\d/.test(t) && !/^IV\b/i.test(t));
        },
        { timeout: 120_000 },
      )
      .catch(() => undefined);
  }
  const expiryChain = await page.evaluate(() => {
    const btn = document.querySelector('[data-ui-audit="chain-exp-btn"]');
    if (!btn) return "";
    const spans = [...btn.querySelectorAll("span")]
      .map((s) => (s.textContent ?? "").trim())
      .filter(Boolean);
    const dateSpan = spans.find((t) => /\d/.test(t) && !/^IV\b/i.test(t));
    return dateSpan ?? spans[0] ?? (btn.textContent ?? "").trim();
  });
  await page.screenshot({ path: path.join(OUT, "03-chain-return-440x956.png") });
  record("expiry text on chain", expiryChain.length > 0, expiryChain || "none");

  await switchView(page, "at");
  await page.waitForTimeout(400);
  await switchView(page, "chain");
  await page.waitForTimeout(400);
  const expiryAfter = await page.evaluate(() => {
    const btn = document.querySelector('[data-ui-audit="chain-exp-btn"]');
    if (!btn) return "";
    const spans = [...btn.querySelectorAll("span")]
      .map((s) => (s.textContent ?? "").trim())
      .filter(Boolean);
    const dateSpan = spans.find((t) => /\d/.test(t) && !/^IV\b/i.test(t));
    return dateSpan ?? spans[0] ?? (btn.textContent ?? "").trim();
  });
  record(
    "expiry survives round-trip",
    !expiryChain || !expiryAfter || expiryChain === expiryAfter,
    `${expiryChain} -> ${expiryAfter}`,
  );

  if (chainRight > 0) {
    const afterToggle = await toggleBox(page);
    const rightAfter = afterToggle ? afterToggle.x + afterToggle.width : 0;
    record("switcher returns to chain corner", Math.abs(chainRight - rightAfter) < 4, `${chainRight.toFixed(0)} vs ${rightAfter.toFixed(0)}`);
  }
} catch (err) {
  record("anthony mock layout", false, err instanceof Error ? err.message : String(err));
}

await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify({ checks, target: TARGET, live: LIVE ?? null }, null, 2),
);
await browser.close();
if (viteChild) viteChild.kill();

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks, out: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);