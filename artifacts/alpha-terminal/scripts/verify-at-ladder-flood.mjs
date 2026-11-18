#!/usr/bin/env node
/**
 * Active Trader ladder check at 440x956 (iPhone 17 Pro Max) in WebKit.
 *
 * Runs a production build against scripts/lib/at-mock-backend.mjs (fixtures only,
 * nothing leaves this machine), opens Options, switches Chain -> Active Trader and,
 * while option quotes stream at --rate updates per second across the contracts the
 * ladder holds, measures:
 *   - what the ladder shows while its strike window loads, and how many strikes land
 *   - whether the ladder fills the space down to the bottom nav and scrolls
 *   - whether prices move and heat is visible
 *   - touch -> highlight time for taps on bid/ask cells
 *
 * Tap timing starts when this process sends the touch, so it includes any wait
 * for a busy main thread:
 *   touch -> highlight          the first visible change for the tap is in the DOM
 *   touch -> highlight painted  ...and a frame with it has been produced
 *   lift  -> outline painted    finger up to a frame with the BUY/SELL outline
 * Playwright's WebKit runs no animation frame between the touchstart and the
 * click of a synthetic tap (about 60 ms, with or without quote load), so the
 * painted times of a tap carry that; the held press at the end is not subject
 * to it and measures a painted highlight while the pointer is still down.
 *
 * With --assert it exits non-zero when touch -> highlight or the held press's
 * painted highlight takes longer than --budget-ms (100), a tap is dropped, the
 * ladder leaves empty space or hides a strike, or heat is not visible.
 *
 *   node scripts/verify-at-ladder-flood.mjs --dist dist/public --label after --assert
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkit } from "playwright";
import { startAtMockBackend } from "./lib/at-mock-backend.mjs";
import { IPHONE_17_PRO_MAX } from "./lib/iphone17ProMax.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const DIST = path.resolve(arg("dist", path.resolve(HERE, "../dist/public")));
const LABEL = arg("label", "run");
const OUT = path.resolve(arg("out", "/opt/cursor/artifacts"));
const RATE = Number(arg("rate", "200"));
const PORT = Number(arg("port", "4517"));
const BUDGET_MS = Number(arg("budget-ms", "100"));
const ASSERT = flag("assert");
const SHOTS = !flag("no-shots");
const TAP_TIMEOUT_MS = Number(arg("tap-timeout-ms", "20000"));
const VIEW_H = Number(arg("height", String(IPHONE_17_PRO_MAX.height)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[at-flood:${LABEL}]`, ...a);

function probeInitScript() {
  const probe = {
    wsOptionMsgs: 0,
    wsQuoteMsgs: 0,
    frameGaps: [],
    quoteTextChanges: 0,
    tap: null,
    eventLog: [],
  };
  window.__atProbe = probe;

  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (e) => {
        const d = e.data;
        if (typeof d !== "string") return;
        if (d.startsWith('{"event":"optionQuote"')) probe.wsOptionMsgs += 1;
        else if (d.startsWith('{"event":"quote"')) probe.wsQuoteMsgs += 1;
      });
    }
  };

  let lastFrame = performance.now();
  const frameLoop = () => {
    const now = performance.now();
    probe.frameGaps.push(now - lastFrame);
    if (probe.frameGaps.length > 20_000) probe.frameGaps.splice(0, 10_000);
    lastFrame = now;
    requestAnimationFrame(frameLoop);
  };
  requestAnimationFrame(frameLoop);

  const isSelected = (cell) =>
    !!cell && (cell.hasAttribute("data-at-leg-selected") || !!cell.querySelector("[data-at-selected-leg-chip]"));
  const isPressed = (cell) => !!cell && cell.hasAttribute("data-at-pressed");
  probe.isSelected = (sel) => isSelected(document.querySelector(sel));

  for (const type of ["touchstart", "pointerdown", "pointerup", "pointercancel", "touchend", "mousedown", "mouseup", "click"]) {
    document.addEventListener(
      type,
      (e) => {
        const rec = probe.tap;
        if (!rec || rec.done) return;
        const arrive = performance.now();
        rec.events.push({ type, ts: e.timeStamp, arrive });
        if (rec.down == null && (type === "touchstart" || type === "pointerdown" || type === "mousedown")) {
          rec.down = { ts: e.timeStamp, arrive, arriveEpoch: performance.timeOrigin + arrive };
        }
        if (rec.up == null && (type === "touchend" || type === "pointerup" || type === "mouseup")) {
          rec.up = { arrive, arriveEpoch: performance.timeOrigin + arrive };
        }
      },
      { capture: true, passive: true },
    );
  }

  const epoch = () => performance.timeOrigin + performance.now();
  /**
   * Runs `cb` once the next frame has been produced: a task queued behind that
   * frame's rendering, or the start of the frame after it, whichever comes
   * first (on a page with a backlog of queued messages the task can wait far
   * longer than the frame did).
   */
  const afterPaint = (cb) => {
    let fired = false;
    const once = () => {
      if (fired) return;
      fired = true;
      cb();
    };
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = once;
      ch.port2.postMessage(0);
      requestAnimationFrame(once);
    });
  };

  let observer = null;
  probe.armTap = (selector) => {
    observer?.disconnect();
    const rec = {
      selector,
      armedAt: performance.now(),
      wasSelected: isSelected(document.querySelector(selector)),
      events: [],
      down: null,
      up: null,
      pressedCommit: null,
      pressedCommitEpoch: null,
      pressedPaintEpoch: null,
      selCommit: null,
      selCommitEpoch: null,
      selPaintEpoch: null,
      done: false,
    };
    probe.tap = rec;
    const check = () => {
      if (rec.down == null) return;
      const cell = document.querySelector(selector);
      const now = performance.now();
      if (rec.pressedCommit == null && isPressed(cell)) {
        rec.pressedCommit = now;
        rec.pressedCommitEpoch = epoch();
        afterPaint(() => {
          rec.pressedPaintEpoch = epoch();
        });
      }
      if (rec.selCommit == null && isSelected(cell) !== rec.wasSelected) {
        rec.selCommit = now;
        rec.selCommitEpoch = epoch();
        afterPaint(() => {
          rec.selPaintEpoch = epoch();
          rec.done = true;
        });
      }
    };
    observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    return true;
  };
  probe.readTap = () => {
    const rec = probe.tap;
    if (!rec) return null;
    return JSON.parse(JSON.stringify(rec));
  };

  probe.watchQuoteText = () => {
    const root = document.querySelector("[data-at-ladder-scroll]");
    if (!root) return false;
    probe.quoteTextChanges = 0;
    probe.quoteObserver?.disconnect();
    probe.quoteObserver = new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        if (el?.closest?.("[data-at-quote]")) probe.quoteTextChanges += 1;
      }
    });
    probe.quoteObserver.observe(root, { subtree: true, characterData: true, childList: true });
    return true;
  };
}

function frameStats(gaps) {
  if (!gaps.length) return { n: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    n: gaps.length,
    p50: Math.round(q(0.5) * 10) / 10,
    p95: Math.round(q(0.95) * 10) / 10,
    max: Math.round(sorted[sorted.length - 1]),
    over50ms: gaps.filter((g) => g > 50).length,
    over100ms: gaps.filter((g) => g > 100).length,
    over500ms: gaps.filter((g) => g > 500).length,
  };
}

async function ladderSnapshot(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector("[data-at-ladder-scroll]");
    const nav = document.querySelector("[data-bottom-nav]");
    const rows = [...document.querySelectorAll("[data-at-ladder-row]")];
    const strikes = rows.map((r) => Number(r.getAttribute("data-at-ladder-row")));
    const sRect = scroll?.getBoundingClientRect();
    const navTop = nav?.getBoundingClientRect().top ?? window.innerHeight;
    const sheet =
      document.querySelector("[data-at-order-sheet]") ??
      document.querySelector("[data-at-docked-order-panel]") ??
      document.querySelector("[data-order-ticket-sheet]");
    const sheetRect = sheet?.getBoundingClientRect();
    let visible = 0;
    let lastRowBottom = null;
    const floor = sRect?.top ?? 0;
    const ceil = Math.min(sRect?.bottom ?? 0, navTop);
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (b.bottom > floor + 1 && b.top < ceil - 1) visible += 1;
      lastRowBottom = b.bottom;
    }
    const spot = document.querySelector("[data-at-spot-row], [data-at-ladder-row][data-at-spot]");
    return {
      rowCount: rows.length,
      topStrike: strikes[0] ?? null,
      bottomStrike: strikes[strikes.length - 1] ?? null,
      descending: strikes.every((s, i) => i === 0 || s < strikes[i - 1]),
      visibleRows: visible,
      scrollTop: scroll ? Math.round(scroll.scrollTop) : null,
      scrollHeight: scroll?.scrollHeight ?? null,
      clientHeight: scroll?.clientHeight ?? null,
      canScroll: scroll ? scroll.scrollHeight > scroll.clientHeight + 4 : false,
      ladderTop: sRect ? Math.round(sRect.top) : null,
      ladderBottom: sRect ? Math.round(sRect.bottom) : null,
      navTop: Math.round(navTop),
      gapLadderToNavPx: sRect ? Math.round(navTop - sRect.bottom) : null,
      emptyBelowLastRowPx: lastRowBottom != null ? Math.max(0, Math.round(Math.min(navTop, window.innerHeight) - lastRowBottom)) : null,
      sheetTop: sheetRect ? Math.round(sheetRect.top) : null,
      sheetHeight: sheetRect ? Math.round(sheetRect.height) : null,
      spotMarked: !!spot,
      skeleton: !!document.querySelector("[data-at-ladder-skeleton]"),
    };
  });
}

async function heatSnapshot(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector("[data-at-ladder-scroll]");
    const box = scroll?.getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll("[data-at-quote-heat]")) {
      const r = el.getBoundingClientRect();
      if (!box || r.bottom < box.top || r.top > box.bottom) continue;
      const row = el.closest("[data-at-ladder-row]");
      const cs = getComputedStyle(el);
      const bg = `${cs.backgroundImage} ${cs.backgroundColor}`;
      // Only the heat green / red count, not neutral overlays.
      const alphas = [...bg.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/g)]
        .filter((m) => (m[1] === "16" && m[2] === "185") || (m[1] === "228" && m[2] === "48"))
        .map((m) => (m[4] == null ? 1 : Number(m[4])));
      out.push({
        strike: Number(row?.getAttribute("data-at-ladder-row")),
        side: el.getAttribute("data-at-quote-heat"),
        intensity: Number(el.getAttribute("data-at-quote-heat-intensity") ?? "0"),
        contracts: el.getAttribute("data-at-quote-heat-contracts"),
        maxAlpha: alphas.length ? Math.max(...alphas) : 0,
      });
    }
    return out;
  });
}

function summarizeHeat(cells) {
  const lit = cells.filter((c) => c.maxAlpha >= 0.12);
  const strong = cells.filter((c) => c.maxAlpha >= 0.3);
  const top = [...cells].sort((a, b) => b.maxAlpha - a.maxAlpha).slice(0, 8);
  return {
    visibleCells: cells.length,
    litCells: lit.length,
    strongCells: strong.length,
    distinctAlphaLevels: new Set(cells.map((c) => c.maxAlpha.toFixed(2))).size,
    maxAlpha: cells.reduce((m, c) => Math.max(m, c.maxAlpha), 0),
    top: top.map((c) => `${c.side[0].toUpperCase()}${c.strike}:${c.maxAlpha.toFixed(2)}`),
  };
}

/** A point to touch on a cell: the middle of the part of it that is not under the order sheet. */
async function cellCenter(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const scroll = document.querySelector("[data-at-ladder-scroll]");
    const r = el.getBoundingClientRect();
    const box = scroll?.getBoundingClientRect();
    const nav = document.querySelector("[data-bottom-nav]")?.getBoundingClientRect();
    const sheet = (
      document.querySelector("[data-at-order-sheet]") ?? document.querySelector("[data-at-docked-order-panel]")
    )?.getBoundingClientRect();
    const top = Math.max(r.top, box?.top ?? 0);
    const bottom = Math.min(r.bottom, box?.bottom ?? 1e9, nav?.top ?? 1e9, sheet?.top ?? 1e9);
    const cx = r.left + r.width / 2;
    const cy = (top + bottom) / 2;
    const hitEl = bottom - top >= 10 ? document.elementFromPoint(cx, cy) : null;
    return {
      x: cx,
      y: cy,
      inView: bottom - top >= 10,
      hit: !!hitEl && (hitEl === el || el.contains(hitEl)),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    };
  }, selector);
}

/**
 * Scroll the ladder to one end the way a user would, letting each page of
 * strikes load, until no more arrive. Returns the pages seen on the way.
 */
async function scrollToEnd(page, edge) {
  const pages = [];
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 12 && stable < 2; i++) {
    await page.evaluate((dir) => {
      const el = document.querySelector("[data-at-ladder-scroll]");
      if (!el) return;
      // Two steps so the scroll has a direction even when already near the edge.
      el.scrollTop += dir === "down" ? -60 : 60;
      el.scrollTop = dir === "down" ? el.scrollHeight : 0;
    }, edge);
    await sleep(900);
    const snap = await ladderSnapshot(page);
    if (snap.rowCount === last) stable += 1;
    else {
      stable = 0;
      last = snap.rowCount;
      pages.push(`${snap.rowCount} rows (${snap.topStrike}..${snap.bottomStrike})`);
    }
  }
  await page.evaluate((dir) => {
    const el = document.querySelector("[data-at-ladder-scroll]");
    if (el) el.scrollTop = dir === "down" ? el.scrollHeight : 0;
  }, edge);
  await sleep(500);
  return pages;
}

/** Where the first and last strike rows sit relative to the ladder area and the order sheet. */
async function endGeometry(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector("[data-at-ladder-scroll]");
    const rows = [...document.querySelectorAll("[data-at-ladder-row]")];
    const sheet = document.querySelector("[data-at-order-sheet]") ?? document.querySelector("[data-at-docked-order-panel]");
    const box = scroll.getBoundingClientRect();
    const first = rows[0]?.getBoundingClientRect();
    const lastRow = rows[rows.length - 1]?.getBoundingClientRect();
    const sheetTop = sheet ? sheet.getBoundingClientRect().top : box.bottom;
    return {
      firstStrike: Number(rows[0]?.getAttribute("data-at-ladder-row")),
      lastStrike: Number(rows[rows.length - 1]?.getAttribute("data-at-ladder-row")),
      firstRowTopInLadder: first ? Math.round(first.top - box.top) : null,
      lastRowBottomAboveSheetPx: lastRow ? Math.round(sheetTop - lastRow.bottom) : null,
      sheetOverlapsLadderPx: Math.round(box.bottom - sheetTop),
      ladderHeightPx: Math.round(box.height),
    };
  });
}

const nodeEpoch = () => performance.timeOrigin + performance.now();
/** One decimal, floored at 0: the two processes' clocks agree to about a millisecond. */
const round1 = (v) => (v == null ? null : Math.max(0, Math.round(v * 10) / 10));

/**
 * Tap a cell and time it end to end: from the instant this process sends the
 * touch to the browser until the frame showing the leg outline has been
 * produced. That includes any wait for a busy main thread to pick the touch up.
 */
async function tapCell(page, selector, how = "touch") {
  let c = await cellCenter(page, selector);
  if (!c) return { selector, error: "cell not found" };
  if (!c.inView || !c.hit) {
    // Bring the row into the part of the ladder that is not under the ticket.
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const scroll = document.querySelector("[data-at-ladder-scroll]");
      if (!el || !scroll) return;
      const box = scroll.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      scroll.scrollTop += r.top - box.top - box.height * 0.25;
    }, selector);
    await sleep(400);
    c = await cellCenter(page, selector);
  }
  if (!c || !c.inView || !c.hit) return { selector, error: `cell not tappable (inView=${c?.inView} hit=${c?.hit})` };
  if (c.disabled) return { selector, error: "cell disabled" };
  await page.evaluate((sel) => window.__atProbe.armTap(sel), selector);
  const startedAt = Date.now();
  const sentEpoch = nodeEpoch();
  if (how === "touch") await page.touchscreen.tap(c.x, c.y);
  else await page.mouse.click(c.x, c.y);
  let rec = null;
  while (Date.now() - startedAt < TAP_TIMEOUT_MS) {
    rec = await page.evaluate(() => window.__atProbe.readTap());
    if (rec?.done) break;
    await sleep(20);
  }
  if (!rec?.down) return { selector, error: "no pointer event reached the page", waitedMs: Date.now() - startedAt };
  const t0 = rec.down.arrive;
  const first = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
  const feedbackCommit = first(rec.pressedCommitEpoch, rec.selCommitEpoch);
  const feedbackPaint = first(rec.pressedPaintEpoch, rec.selPaintEpoch);
  return {
    selector,
    registered: !!rec.done,
    /** Touch sent -> the page's handler ran. Long when the main thread is busy. */
    waitForMainThreadMs: round1(rec.down.arriveEpoch - sentEpoch),
    /**
     * Touch sent -> the first visible change for this tap is in the DOM: the press
     * highlight, or the BUY/SELL outline on a build that has no press highlight.
     */
    touchToHighlightMs: feedbackCommit == null ? null : round1(feedbackCommit - sentEpoch),
    /** ...and a frame containing it has been produced. */
    touchToHighlightPaintedMs: feedbackPaint == null ? null : round1(feedbackPaint - sentEpoch),
    /** Finger lifted -> a frame with the BUY/SELL outline (or its removal) has been produced. */
    liftToOutlinePaintedMs:
      rec.selPaintEpoch == null || rec.up == null ? null : round1(rec.selPaintEpoch - rec.up.arriveEpoch),
    touchToOutlinePaintedMs: rec.selPaintEpoch == null ? null : round1(rec.selPaintEpoch - sentEpoch),
    hadPressHighlight: rec.pressedCommitEpoch != null,
    fingerDownMs: rec.up == null ? null : round1(rec.up.arrive - t0),
    events: rec.events.map((e) => `${e.type}@${Math.round(e.arrive - t0)}`).join(" "),
  };
}

/**
 * Press and hold with the mouse (Playwright's WebKit touch API can only tap):
 * the cell must light up while the pointer is still down, a release must
 * commit the leg, and dragging past the slop before releasing must not.
 */
async function pressHoldAndDrag(page, selector) {
  const c = await cellCenter(page, selector);
  if (!c || !c.inView || !c.hit || c.disabled) return { selector, error: "cell not pressable" };
  const out = { selector };
  const state = () =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return { pressed: !!el?.hasAttribute("data-at-pressed"), selected: window.__atProbe.isSelected(sel) };
    }, selector);
  const before = await state();

  await page.mouse.move(c.x, c.y);
  await page.evaluate((sel) => window.__atProbe.armTap(sel), selector);
  const sentEpoch = nodeEpoch();
  await page.mouse.down();
  await sleep(160);
  const held = await state();
  const rec = await page.evaluate(() => window.__atProbe.readTap());
  out.highlightWhileHeld = held.pressed;
  out.pressToHighlightPaintedMs =
    rec?.pressedPaintEpoch == null ? null : round1(rec.pressedPaintEpoch - sentEpoch);
  out.committedBeforeLift = held.selected !== before.selected;
  await page.mouse.move(c.x + 14, c.y + 3, { steps: 3 });
  await sleep(60);
  const dragged = await state();
  await page.mouse.up();
  await sleep(250);
  const afterDrag = await state();
  out.dragCancelsHighlight = !dragged.pressed;
  out.dragDoesNotCommit = afterDrag.selected === before.selected;
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    throw new Error(`No build at ${DIST}. Build with VITE_AUTH_DISABLED=1 first.`);
  }
  const backend = await startAtMockBackend({ distDir: DIST, port: PORT, optionUpdatesPerSec: RATE, quiet: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: IPHONE_17_PRO_MAX.width, height: VIEW_H },
    deviceScaleFactor: IPHONE_17_PRO_MAX.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/New_York",
    locale: "en-US",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 300)));
  await page.addInitScript(probeInitScript);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
    } catch {
      /* ignore */
    }
  });

  const result = { label: LABEL, dist: DIST, viewport: `440x${VIEW_H}@3x WebKit`, requestedRate: RATE, budgetMs: BUDGET_MS };
  const shot = async (name) => {
    if (!SHOTS) return;
    const file = path.join(OUT, `at-ladder-${LABEL}-${name}-440x${VIEW_H}.png`);
    await page.screenshot({ path: file });
    log("screenshot", file);
  };

  try {
    await page.goto(backend.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText("MARKETS", { exact: true }).waitFor({ timeout: 45_000 });
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    await page.locator("[data-at-subview-hit]").waitFor({ timeout: 20_000 });
    await page.locator('[data-ui-audit="chain-bid-cell"]').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    await sleep(2500);

    await page.evaluate(() => (window.__atProbe.frameGaps.length = 0));
    await sleep(3000);
    result.chainView = {
      frames: frameStats(await page.evaluate(() => window.__atProbe.frameGaps.slice())),
      heldContracts: backend.heldCount(),
    };
    log("chain view", JSON.stringify(result.chainView));

    // Chain -> Active Trader. Sample what the ladder shows while its own window loads.
    backend.control.optionsDelayMs = 900;
    const switchAt = Date.now();
    await page.locator("[data-at-subview-hit]").click();
    const timeline = [];
    let fullAt = null;
    while (Date.now() - switchAt < 12_000) {
      const snap = await ladderSnapshot(page).catch(() => null);
      const t = Date.now() - switchAt;
      if (snap) {
        timeline.push({ t, rows: snap.rowCount, top: snap.topStrike, bottom: snap.bottomStrike, skeleton: snap.skeleton });
        if (fullAt == null && snap.rowCount >= 36) fullAt = t;
      }
      if (fullAt != null && t > fullAt + 1200) break;
      await sleep(100);
    }
    backend.control.optionsDelayMs = 250;
    const distinct = [];
    for (const s of timeline) {
      const lastSeen = distinct[distinct.length - 1];
      if (!lastSeen || lastSeen.rows !== s.rows || lastSeen.skeleton !== s.skeleton) distinct.push(s);
    }
    result.switchToActiveTrader = {
      msUntilFullWindow: fullAt,
      showedPartialStrikeList: timeline.some((s) => s.rows > 0 && s.rows < 30),
      states: distinct.map((s) => `${s.t}ms: ${s.rows} rows${s.rows ? ` (${s.top}..${s.bottom})` : ""}${s.skeleton ? " +skeleton" : ""}`),
    };
    log("switch", JSON.stringify(result.switchToActiveTrader));

    await sleep(6000);
    result.ladderNoLegs = await ladderSnapshot(page);
    log("ladder (no legs)", JSON.stringify(result.ladderNoLegs));

    // Quote flood: rate reaching the page, frame pacing, price movement.
    await page.evaluate(() => {
      window.__atProbe.frameGaps.length = 0;
      window.__atProbe.wsOptionMsgs = 0;
      window.__atProbe.watchQuoteText();
    });
    const floodT0 = Date.now();
    await sleep(5000);
    const flood = await page.evaluate(() => ({
      ws: window.__atProbe.wsOptionMsgs,
      gaps: window.__atProbe.frameGaps.slice(),
      textChanges: window.__atProbe.quoteTextChanges,
    }));
    const floodSec = (Date.now() - floodT0) / 1000;
    result.flood = {
      heldContracts: backend.heldCount(),
      optionUpdatesPerSecAtPage: Math.round(flood.ws / floodSec),
      priceCellChangesPerSec: Math.round(flood.textChanges / floodSec),
      frames: frameStats(flood.gaps),
    };
    log("flood", JSON.stringify(result.flood));

    await sleep(26_000);
    result.heat = summarizeHeat(await heatSnapshot(page));
    log("heat", JSON.stringify(result.heat));
    await shot("no-legs");

    // Iron condor like the mock-up: sell the near call and put, buy the wings.
    const atm = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("[data-at-ladder-row]")];
      const scroll = document.querySelector("[data-at-ladder-scroll]").getBoundingClientRect();
      const mid = scroll.top + scroll.height * 0.42;
      let best = null;
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        const d = Math.abs((b.top + b.bottom) / 2 - mid);
        if (!best || d < best.d) best = { d, strike: Number(r.getAttribute("data-at-ladder-row")) };
      }
      return best?.strike ?? null;
    });
    const legCells = [
      `[data-at-quote="call-bid-${atm + 10}"]`,
      `[data-at-quote="call-ask-${atm + 20}"]`,
      `[data-at-quote="put-bid-${atm - 10}"]`,
      `[data-at-quote="put-ask-${atm - 20}"]`,
    ];
    const taps = [];
    for (const sel of legCells) {
      const t = await tapCell(page, sel);
      taps.push({ step: "add leg", ...t });
      log("tap", JSON.stringify(t));
      await sleep(350);
    }
    result.ladderFourLegs = await ladderSnapshot(page);
    result.legCount = await page.evaluate(() => document.querySelectorAll("[data-at-selected-leg-chip]").length);
    log("ladder (4 legs)", JSON.stringify(result.ladderFourLegs), "legs", result.legCount);
    await sleep(400);
    await shot("4-legs");

    // More taps with the ticket open: remove and re-add legs that are not under the sheet.
    for (let round = 0; round < 3; round++) {
      for (const sel of legCells.slice(0, 2)) {
        for (const step of ["remove leg", "add leg"]) {
          const t = await tapCell(page, sel);
          taps.push({ step, ...t });
          log("tap", JSON.stringify(t));
          await sleep(300);
        }
      }
    }
    const spread = (field) => {
      const v = taps.map((t) => t[field]).filter((n) => n != null).sort((a, b) => a - b);
      return v.length ? { min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1], n: v.length } : null;
    };
    result.taps = {
      attempted: taps.length,
      registered: taps.filter((t) => t.registered).length,
      withPressHighlight: taps.filter((t) => t.hadPressHighlight).length,
      waitForMainThreadMs: spread("waitForMainThreadMs"),
      touchToHighlightMs: spread("touchToHighlightMs"),
      touchToHighlightPaintedMs: spread("touchToHighlightPaintedMs"),
      liftToOutlinePaintedMs: spread("liftToOutlinePaintedMs"),
      touchToOutlinePaintedMs: spread("touchToOutlinePaintedMs"),
      detail: taps,
    };
    result.pressHold = await pressHoldAndDrag(page, `[data-at-quote="call-ask-${atm + 5}"]`);
    log("press/hold/drag", JSON.stringify(result.pressHold));

    // With the ticket open: every strike must still be reachable at both ends.
    const legsBeforeScroll = await page.evaluate(() => document.querySelectorAll("[data-at-selected-leg-chip]").length);
    const downPages = await scrollToEnd(page, "down");
    await sleep(600);
    result.bottomEnd = { pages: downPages, ...(await endGeometry(page)) };
    log("bottom end", JSON.stringify(result.bottomEnd));
    await shot("bottom-end");

    const upPages = await scrollToEnd(page, "up");
    await sleep(600);
    result.topEnd = { pages: upPages, ...(await endGeometry(page)) };
    log("top end", JSON.stringify(result.topEnd));
    await shot("top-end");

    const recenter = page.locator("[data-at-ladder-recenter]");
    result.recenter = { shownWhenSpotOffScreen: await recenter.isVisible().catch(() => false) };
    if (result.recenter.shownWhenSpotOffScreen) {
      await recenter.click();
      await sleep(1200);
      result.recenter.spotBackInView = await page.evaluate(() => {
        const spot = document.querySelector('[data-at-spot-row="1"]');
        const scroll = document.querySelector("[data-at-ladder-scroll]");
        const sheet = document.querySelector("[data-at-order-sheet]");
        if (!spot || !scroll) return false;
        const r = spot.getBoundingClientRect();
        const box = scroll.getBoundingClientRect();
        const limit = sheet ? sheet.getBoundingClientRect().top : box.bottom;
        return r.top >= box.top - 1 && r.bottom <= limit + 1;
      });
      result.recenter.hiddenAfter = !(await recenter.isVisible().catch(() => false));
    }
    result.legsKeptWhileScrolling =
      (await page.evaluate(() => document.querySelectorAll("[data-at-selected-leg-chip]").length)) > 0 ||
      legsBeforeScroll === 0;
    log("recenter", JSON.stringify(result.recenter));

    // Collapse the ticket to its one-line bar and bring it back.
    const handle = page.locator("[data-at-order-sheet-handle]");
    if (await handle.count()) {
      const open = await endGeometry(page);
      const hb = await handle.first().boundingBox();
      await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + 7);
      await sleep(500);
      const collapsed = await endGeometry(page);
      await shot("ticket-collapsed");
      const hb2 = await handle.first().boundingBox();
      await page.touchscreen.tap(hb2.x + hb2.width / 2, hb2.y + 7);
      await sleep(500);
      const reopened = await endGeometry(page);
      result.ticketCollapse = {
        openOverlapPx: open.sheetOverlapsLadderPx,
        collapsedOverlapPx: collapsed.sheetOverlapsLadderPx,
        reopenedOverlapPx: reopened.sheetOverlapsLadderPx,
        ladderHeightUnchanged:
          open.ladderHeightPx === collapsed.ladderHeightPx && open.ladderHeightPx === reopened.ladderHeightPx,
      };
      log("ticket collapse", JSON.stringify(result.ticketCollapse));
    }
    log(
      "taps",
      `${result.taps.registered}/${taps.length} registered`,
      "touch->highlight", JSON.stringify(result.taps.touchToHighlightMs),
      "touch->highlight painted", JSON.stringify(result.taps.touchToHighlightPaintedMs),
      "lift->outline painted", JSON.stringify(result.taps.liftToOutlinePaintedMs),
    );

    result.header = await page.evaluate(() => ({
      gammaFlip: document.querySelector("[data-at-gamma-flip]")?.textContent?.trim() ?? null,
      flipRowStrike: document.querySelector('[data-at-gamma-flip-row="1"]')?.getAttribute("data-at-ladder-row") ?? null,
      callWallRow: document.querySelector('[data-at-strike-wall="call"]')?.closest("[data-at-ladder-row]")?.getAttribute("data-at-ladder-row") ?? null,
      putWallRow: document.querySelector('[data-at-strike-wall="put"]')?.closest("[data-at-ladder-row]")?.getAttribute("data-at-ladder-row") ?? null,
    }));
    log("header", JSON.stringify(result.header));
    result.mock = {
      requests: backend.counters.requests,
      optionRequests: backend.counters.optionRequests,
      unhandledApi: backend.counters.unhandled,
      optionUpdatesSent: backend.counters.optionUpdatesSent,
    };
    result.pageErrors = consoleErrors.slice(0, 10);
  } finally {
    const file = path.join(OUT, `at-ladder-${LABEL}-metrics.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    log("metrics", file);
    await browser.close().catch(() => undefined);
    await backend.close().catch(() => undefined);
  }

  if (ASSERT) {
    const failures = [];
    const t = result.taps;
    if (!t || t.registered !== t.attempted) failures.push(`taps registered ${t?.registered}/${t?.attempted}`);
    if (t && t.withPressHighlight !== t.attempted) {
      failures.push(`press highlight seen on ${t.withPressHighlight}/${t.attempted} taps`);
    }
    if (!t?.touchToHighlightMs || t.touchToHighlightMs.n !== t.attempted) {
      failures.push(`touch-to-highlight measured on ${t?.touchToHighlightMs?.n ?? 0}/${t?.attempted} taps`);
    } else if (t.touchToHighlightMs.max > BUDGET_MS) {
      failures.push(`touch-to-highlight max ${t.touchToHighlightMs.max}ms > ${BUDGET_MS}ms`);
    }
    if (!(result.pressHold?.pressToHighlightPaintedMs <= BUDGET_MS)) {
      failures.push(`held press: highlight painted in ${result.pressHold?.pressToHighlightPaintedMs}ms > ${BUDGET_MS}ms`);
    }
    const noLegs = result.ladderNoLegs;
    if (!noLegs || noLegs.rowCount < 36) failures.push(`ladder loaded ${noLegs?.rowCount} strikes, wanted ~40`);
    if (noLegs && (noLegs.gapLadderToNavPx !== 0 || noLegs.emptyBelowLastRowPx !== 0)) {
      failures.push(`empty space under the ladder: ${noLegs.gapLadderToNavPx}px gap, ${noLegs.emptyBelowLastRowPx}px blank`);
    }
    if (result.switchToActiveTrader?.showedPartialStrikeList) failures.push("ladder showed a partial strike list while loading");
    const four = result.ladderFourLegs;
    if (four && noLegs && four.clientHeight !== noLegs.clientHeight) {
      failures.push(`ticket resized the ladder: ${noLegs.clientHeight}px -> ${four.clientHeight}px`);
    }
    if (result.legCount !== 4) failures.push(`picked ${result.legCount} legs, wanted 4`);
    for (const [name, end] of [["bottom", result.bottomEnd], ["top", result.topEnd]]) {
      if (!end) failures.push(`${name} end not checked`);
    }
    if (result.bottomEnd && result.bottomEnd.lastRowBottomAboveSheetPx < 0) {
      failures.push(`last strike hidden under the ticket by ${-result.bottomEnd.lastRowBottomAboveSheetPx}px`);
    }
    if (result.topEnd && result.topEnd.firstRowTopInLadder !== 0) {
      failures.push(`first strike not reachable (top at ${result.topEnd.firstRowTopInLadder}px)`);
    }
    if ((result.heat?.strongCells ?? 0) < 3) failures.push(`heat not visible: ${JSON.stringify(result.heat)}`);
    const hold = result.pressHold;
    if (!hold?.highlightWhileHeld || hold.committedBeforeLift || !hold.dragCancelsHighlight || !hold.dragDoesNotCommit) {
      failures.push(`press/hold/drag rules: ${JSON.stringify(hold)}`);
    }
    if ((result.flood?.optionUpdatesPerSecAtPage ?? 0) < RATE * 0.9) {
      failures.push(`flood reached the page at ${result.flood?.optionUpdatesPerSecAtPage}/s, wanted ${RATE}/s`);
    }
    if (failures.length) {
      console.error(`[at-flood:${LABEL}] FAIL\n  - ${failures.join("\n  - ")}`);
      process.exit(1);
    }
    log("PASS");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
