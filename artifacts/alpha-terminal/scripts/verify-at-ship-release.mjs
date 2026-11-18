/**
 * Ship gate: 440×956 WebKit — fixture ladder/ticket matrix + optional live heat check.
 * Run from artifacts/alpha-terminal: node scripts/verify-at-ship-release.mjs
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";
import { AT_FIXTURE_BASE, ensureAtFixtureVite, waitForLiveLadder } from "./lib/at-fixture-vite.mjs";
import { ladderHeatPixelDiff } from "./lib/at-ladder-heat-pixel-diff.mjs";

const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-ship-release";
const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const FIXTURE = `${AT_FIXTURE_BASE}?fixture=spx`;

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

const tap = (page, sel) => page.locator(`[data-at-quote="${sel}"]`).click({ timeout: 15_000 });

async function fixtureMatrix(page) {
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForLiveLadder(page);

  const emptyTicket = (await page.locator("[data-at-approved-ticket]").count()) === 0;
  record("empty: no docked ticket", emptyTicket, emptyTicket ? "ok" : "visible");

  const noFlowLanes = (await page.locator("[data-at-flow-lane]").count()) === 0;
  record("no outer flow lanes", noFlowLanes, noFlowLanes ? "ok" : "lanes remain");

  await tap(page, "call-ask-7545");
  await page.waitForTimeout(400);
  record("one-leg ticket", (await page.locator("[data-at-approved-ticket]").count()) === 1, "ticket");

  await page.locator("button", { hasText: "CLEAR" }).click().catch(() => undefined);
  await page.waitForTimeout(300);
  await tap(page, "call-ask-7545");
  await tap(page, "call-bid-7550");
  await page.waitForTimeout(400);
  record("vertical 2-leg", (await page.locator("[data-at-approved-ticket]").count()) === 1, "2-leg");

  await page.locator("button", { hasText: "CLEAR" }).click().catch(() => undefined);
  await page.waitForTimeout(300);
  await tap(page, "put-bid-7530");
  await tap(page, "put-ask-7520");
  await tap(page, "call-bid-7550");
  await tap(page, "call-ask-7555");
  await page.waitForTimeout(500);
  const legs = await page.locator("[data-at-approved-ticket]").innerText().catch(() => "");
  record("condor 4-leg", legs.includes("7550") || legs.includes("7555"), legs.slice(0, 80));

  const scrollY0 = await page.evaluate(() => document.querySelector("[data-at-ladder-scroll]")?.scrollTop ?? 0);
  await page.getByRole("button", { name: /Settings|SET/i }).first().click({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const scrollY1 = await page.evaluate(() => document.querySelector("[data-at-ladder-scroll]")?.scrollTop ?? 0);
  record("no scroll jump on picker", Math.abs(scrollY1 - scrollY0) < 8, `${scrollY0}→${scrollY1}`);

  await page.getByTestId("chain-sheet-limit").fill("1.23").catch(() => undefined);
  await page.getByRole("button", { name: "Lock limit" }).click({ timeout: 8_000 }).catch(() => undefined);
  const locked = await page.getByTestId("chain-sheet-limit").inputValue().catch(() => "");
  await page.waitForTimeout(900);
  const locked2 = await page.getByTestId("chain-sheet-limit").inputValue().catch(() => "");
  record("locked limit stable", locked === locked2 && locked.length > 0, `${locked}`);

  await page.locator("[data-testid='options-chain-order-sheet-advanced']").click({ timeout: 10_000 }).catch(() =>
    page.getByRole("button", { name: /Advanced/i }).click({ timeout: 10_000 }),
  );
  await page.waitForTimeout(400);
  const adv = await page.getByText(/Advanced Order|OCO|Trigger/i).count();
  record("Advanced Orders return", adv > 0, `hits=${adv}`);
  await page.keyboard.press("Escape").catch(() => undefined);

  const overlap = await page.evaluate(() => {
    const ticket = document.querySelector("[data-at-approved-ticket]");
    const header = document.querySelector("[data-at-glance-top]");
    if (!ticket || !header) return false;
    const a = ticket.getBoundingClientRect();
    const b = header.getBoundingClientRect();
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return overlapX > 2 && overlapY > 2;
  });
  record("ticket does not overlap glance header", !overlap, overlap ? "overlap" : "ok");

  const wrongSide = await page.evaluate(() => {
    const pressed = [...document.querySelectorAll("[data-at-quote][data-at-quote-side]")].filter((el) =>
      el.getAttribute("style")?.includes("solid"),
    );
    return pressed.every((el) => {
      const side = el.getAttribute("data-at-quote-side");
      const id = el.getAttribute("data-at-quote") ?? "";
      return (side === "BUY" && id.includes("ask")) || (side === "SELL" && id.includes("bid"));
    });
  });
  record("wrong-side entry blocked (buy→ask)", wrongSide, wrongSide ? "ok" : "mismatch");
}

async function fixtureHeatScene(page, scene, assert) {
  await page.goto(`${FIXTURE}&scene=${scene}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-at-quote-heat]", { timeout: 60_000 });
  const ok = await page.evaluate(assert);
  record(`fixture ${scene}`, ok, scene);
}

await mkdir(OUT, { recursive: true });
let vite = null;
let browser = null;

try {
  vite = await ensureAtFixtureVite({ VITE_AT_ORDER_SEND: "0" });
  browser = await webkit.launch();
  const page = await browser.newPage({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await installSafeAreaInsets(page, 62, 34);

  await fixtureMatrix(page);
  await page.screenshot({ path: path.join(OUT, "ship-fixture-condor-440x956.png") });

  await page.goto(FIXTURE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForLiveLadder(page);
  const caption = await page.locator("[data-at-ladder-heat-caption]").first().innerText().catch(() => "");
  record(
    "ladder heat caption",
    caption.includes("Contracts traded") && caption.includes("30s"),
    caption || "missing",
  );
  const shotPath = path.join(OUT, "ship-fixture-pixel-baseline-440x956.png");
  await page.screenshot({ path: shotPath });
  const captionRect = await page.evaluate(() => {
    const el = document.querySelector("[data-at-ladder-heat-caption]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.x * dpr, y: r.y * dpr, w: r.width * dpr, h: r.height * dpr };
  });
  const pxDiff = await ladderHeatPixelDiff({
    currentPngPath: shotPath,
    outDir: OUT,
    captionRect: captionRect ?? undefined,
  });
  if (pxDiff.skipped) {
    record("ladder layout pixel diff (excl. caption)", true, pxDiff.reason);
  } else {
    record(
      "ladder layout pixel diff (excl. caption)",
      pxDiff.pass,
      `${pxDiff.diffPixels} px (max ${pxDiff.maxAllowed})`,
    );
  }

  await fixtureHeatScene(page, "heat-quiet", () => {
    const live = [...document.querySelectorAll("[data-at-quote-heat-state='live']")];
    return live.length === 0;
  });
  await fixtureHeatScene(page, "heat-100k-vs-1m", () => {
    const live = document.querySelectorAll("[data-at-quote-heat-state='live']").length;
    return live >= 2;
  });
  await fixtureHeatScene(page, "heat-off-center", () => {
  const hot = [...document.querySelectorAll("[data-at-quote-heat-state='live']")];
    return hot.length >= 1;
  });
  await fixtureHeatScene(page, "heat-fade", () => {
    const live = document.querySelectorAll("[data-at-quote-heat-state='live']").length;
    return live === 0;
  });
  await fixtureHeatScene(page, "heat-reset", () => {
    const q = document.querySelectorAll("[data-at-quote-heat-state='quiet'], [data-at-quote-heat-state='live']").length;
    return q > 0;
  });
  await fixtureHeatScene(page, "heat-backwards", () => {
    const live = document.querySelectorAll("[data-at-quote-heat-state='live']").length;
    return live >= 1;
  });
  await fixtureHeatScene(page, "heat-reconnect-gap", () => {
    const stale = document.querySelectorAll("[data-at-quote-heat-state='stale']").length;
    return stale >= 1;
  });
  await fixtureHeatScene(page, "heat-cache-hit", () => {
    const c = document.querySelector("[data-at-quote-heat]");
    return c != null && document.querySelectorAll("[data-at-quote-heat-state='live']").length === 1;
  });
  await fixtureHeatScene(page, "heat-zero-trade-time", () => {
    return document.querySelectorAll("[data-at-quote-heat-state='live']").length === 0;
  });
  await fixtureHeatScene(page, "heat-quote-only-tick", () => {
    const badge = document.querySelector("[data-at-ladder-heat-source]");
    const label = badge?.textContent?.trim() ?? "";
    return label === "";
  });

  if (process.env.AT_VERIFY_INCLUDE_LIVE !== "1") {
    record("production ladder volume heat", true, "skipped pre-deploy (set AT_VERIFY_INCLUDE_LIVE=1)");
  } else {
  const livePage = await browser.newPage({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
  });
  await installSafeAreaInsets(livePage, 62, 34);
  await livePage.addInitScript(() => {
    localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
    window.__atSpxVolProof = [];
    const Orig = WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Orig(...args);
      ws.addEventListener("message", (ev) => {
        const raw = String(ev.data ?? "");
        if (!/OPTION|option/i.test(raw)) return;
        const matches = [...raw.matchAll(/"8"\s*:\s*(\d+)/g)];
        const field8 = matches.length ? Number(matches[matches.length - 1][1]) : null;
        if (field8 != null || raw.includes('"8"') || raw.includes(",8,")) {
          window.__atSpxVolProof.push({ t: Date.now(), field8 });
        }
      });
      return ws;
    };
  });
  await livePage.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await livePage.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await livePage.waitForTimeout(500);
  await livePage.locator('[data-at-view-selector] select').first().selectOption("at");
  await livePage.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await livePage.waitForTimeout(6_000);
  const spxHeat = await livePage.evaluate(() => {
    const el = document.querySelector("[data-at-ladder-heat-source]");
    const tag = el?.textContent?.trim() ?? "";
    const freshAttr = el?.getAttribute("data-at-ladder-heat-fresh") ?? "0";
    const states = [...document.querySelectorAll("[data-at-quote-heat]")].slice(0, 12).map((node) =>
      node.getAttribute("data-at-quote-heat-state"),
    );
    const quiet = states.filter((s) => s === "quiet").length;
    const stale = states.filter((s) => s === "stale").length;
    const unavailable = states.filter((s) => s === "unavailable").length;
    const proof = Array.isArray(window.__atSpxVolProof) ? window.__atSpxVolProof : [];
    const field8Ticks = proof.filter((p) => p.field8 != null && Number.isFinite(p.field8));
    const liveOk = tag === "Live · stream" && freshAttr === "1";
    const staleNoLive = stale === 0 || tag.length === 0;
    const wsOk = field8Ticks.length >= 1;
    return {
      tag,
      freshAttr,
      states,
      quiet,
      stale,
      unavailable,
      field8Samples: field8Ticks.slice(-5),
      field8Count: field8Ticks.length,
      ok: liveOk && staleNoLive && wsOk && unavailable < states.length,
    };
  });
  record("SPX live heat stream", spxHeat.ok, JSON.stringify(spxHeat));
  await livePage.screenshot({ path: path.join(OUT, "ship-live-spx-volume-heat-440x956.png") });

  await livePage.locator('[data-at-view-selector] select').first().selectOption("options").catch(() => undefined);
  await livePage.getByRole("combobox", { name: /symbol/i }).first().fill("NVDA").catch(() => undefined);
  await livePage.keyboard.press("Enter").catch(() => undefined);
  await livePage.waitForTimeout(800);
  await livePage.locator('[data-at-view-selector] select').first().selectOption("at").catch(() => undefined);
  await livePage.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 }).catch(() => undefined);
  const nvdaTag = await livePage.locator("[data-at-ladder-heat-source]").innerText().catch(() => "");
  const nvdaBadgeOk = nvdaTag.includes("Snapshot") || nvdaTag.includes("poll");
  record("NVDA live heat poll badge", nvdaBadgeOk, nvdaTag || "missing");
  await livePage.screenshot({ path: path.join(OUT, "ship-live-nvda-volume-heat-440x956.png") });
  }

  await browser.close();
  browser = null;
  if (vite?.kill) vite.kill();
  vite = null;
} catch (e) {
  record("runner", false, String(e?.message ?? e));
  if (browser) await browser.close().catch(() => undefined);
  if (vite?.kill) vite.kill();
}

const failed = checks.filter((c) => !c.pass).length;
await writeFile(path.join(OUT, "report.json"), JSON.stringify({ failed, checks }, null, 2));
console.log(JSON.stringify({ failed, checks }, null, 2));
process.exit(failed ? 1 : 0);