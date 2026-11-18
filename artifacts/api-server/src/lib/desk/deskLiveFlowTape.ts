import { classifyFlowAgainstPriorQuote } from "./deskLiveFlowClassify.js";
import {
  deskLiveFlowBroadcastFrame,
  wrapDeskLiveFlowFrame,
  type DeskLiveFlowFrame,
} from "./deskLiveFlowHub.js";
import {
  DESK_LIVE_FLOW_PX_MAX_PER_SEC,
  DESK_LIVE_FLOW_QUOTE_HISTORY_CAP,
  DESK_LIVE_FLOW_TAPE_REORDER_MS,
  deskLiveFlowEnabled,
} from "./deskLiveFlowConfig.js";
import type { DeskFlowAssetKind } from "./deskLiveFlowSymbol.js";
import { deskLiveFlowSubsSymbolActive } from "./deskLiveFlowSubs.js";
import {
  bucketDueToClose,
  bucketMs1s,
  deskLiveFlowBucketsRegister,
  minuteMs,
} from "./deskLiveFlowBuckets.js";
import {
  deskLiveFlowTestFrameCount,
  deskLiveFlowTestRecordFrame,
  deskLiveFlowTestSliceFrames,
} from "./deskLiveFlowTestBuffer.js";
import { deskLiveFlowFuturesContractMultiplier, deskLiveFlowFuturesNotionalDollars } from "./deskLiveFlowFuturesMult.js";

type TapeBucket1s = {
  bucket_ms: number;
  buy_vol: number;
  sell_vol: number;
  mid_vol: number;
  buy_$: number;
  sell_$: number;
  mid_$: number;
  buy_$_known: boolean;
  sell_$_known: boolean;
  mid_$_known: boolean;
  vwap_num: number;
  vwap_den: number;
  last: number | null;
  n_prints: number;
  src: "schwab_timesale" | "schwab_l1_est";
};

type TapeBucket60s = TapeBucket1s & { minute_ms: number };

type QuoteSnap = {
  bid: number;
  ask: number;
  bidSize: number | null;
  askSize: number | null;
  last: number | null;
};

type QuoteHistoryEntry = QuoteSnap & { quoteMs: number };

type SymbolState = {
  kind: DeskFlowAssetKind;
  prevQuote: QuoteSnap | null;
  prevVolume: number | null;
  quoteHistory: QuoteHistoryEntry[];
  open1s: TapeBucket1s | null;
  open60s: TapeBucket60s | null;
  lastEmitted1sBucketMs: number | null;
  lastEmitted60sMinuteMs: number | null;
  lastBookEmitMs: number;
  lastBook: QuoteSnap | null;
  bookTrailing: QuoteSnap | null;
  bookTrailingTimer: ReturnType<typeof setTimeout> | null;
  timesaleSeen: boolean;
  l1Fallback: boolean;
  lastPrintSeq: number | null;
  lastPrintClockMs: number;
};

const states = new Map<string, SymbolState>();
let bucketsHooked = false;

function ensureBucketTimer(): void {
  if (bucketsHooked) return;
  bucketsHooked = true;
  deskLiveFlowBucketsRegister((now) => deskLiveFlowTapeBucketTick(now));
}

function recordFrame(frame: DeskLiveFlowFrame): void {
  deskLiveFlowTestRecordFrame(frame);
  deskLiveFlowBroadcastFrame(frame);
}

function symKey(sym: string): string {
  return sym.toUpperCase();
}

function fresh1s(ms: number, src: TapeBucket1s["src"]): TapeBucket1s {
  return {
    bucket_ms: bucketMs1s(ms),
    buy_vol: 0,
    sell_vol: 0,
    mid_vol: 0,
    buy_$: 0,
    sell_$: 0,
    mid_$: 0,
    buy_$_known: true,
    sell_$_known: true,
    mid_$_known: true,
    vwap_num: 0,
    vwap_den: 0,
    last: null,
    n_prints: 0,
    src,
  };
}

function fresh60s(ms: number, src: TapeBucket1s["src"]): TapeBucket60s {
  const b = fresh1s(ms, src);
  return { ...b, minute_ms: minuteMs(ms) };
}

function stateFor(sym: string, kind: DeskFlowAssetKind): SymbolState {
  const k = symKey(sym);
  let s = states.get(k);
  if (!s) {
    s = {
      kind,
      prevQuote: null,
      prevVolume: null,
      quoteHistory: [],
      open1s: null,
      open60s: null,
      lastEmitted1sBucketMs: null,
      lastEmitted60sMinuteMs: null,
      lastBookEmitMs: 0,
      lastBook: null,
      bookTrailing: null,
      bookTrailingTimer: null,
      timesaleSeen: false,
      l1Fallback: false,
      lastPrintSeq: null,
      lastPrintClockMs: 0,
    };
    states.set(k, s);
  }
  return s;
}

function pushQuoteHistory(st: SymbolState, q: QuoteSnap, quoteMs: number): void {
  st.quoteHistory.push({ ...q, quoteMs });
  if (st.quoteHistory.length > DESK_LIVE_FLOW_QUOTE_HISTORY_CAP) {
    st.quoteHistory.splice(0, st.quoteHistory.length - DESK_LIVE_FLOW_QUOTE_HISTORY_CAP);
  }
}

function quoteAtOrBefore(st: SymbolState, tradeMs: number): QuoteSnap | null {
  for (let i = st.quoteHistory.length - 1; i >= 0; i--) {
    const e = st.quoteHistory[i]!;
    if (e.quoteMs <= tradeMs) {
      return { bid: e.bid, ask: e.ask, bidSize: e.bidSize, askSize: e.askSize, last: e.last };
    }
  }
  return st.prevQuote;
}

function eventClockMs(
  tradeMs: number | null,
  rxMs: number,
  seq: number | null,
  st: SymbolState,
): number | null {
  if (seq != null && st.lastPrintSeq != null && seq < st.lastPrintSeq) return null;
  if (seq != null) st.lastPrintSeq = seq;
  let clock = rxMs;
  if (tradeMs != null && tradeMs <= rxMs && rxMs - tradeMs <= DESK_LIVE_FLOW_TAPE_REORDER_MS) {
    clock = tradeMs;
  }
  let bucket = bucketMs1s(clock);
  if (st.lastEmitted1sBucketMs != null && bucket < st.lastEmitted1sBucketMs) {
    if (st.open1s && st.open1s.bucket_ms >= st.lastEmitted1sBucketMs) {
      bucket = st.open1s.bucket_ms;
      clock = Math.max(clock, bucket);
    } else {
      clock = Math.max(rxMs, st.lastEmitted1sBucketMs + 1);
      bucket = bucketMs1s(clock);
    }
  }
  if (clock < st.lastPrintClockMs && st.open1s && bucketMs1s(clock) === st.open1s.bucket_ms) {
    clock = Math.max(clock, st.lastPrintClockMs);
  }
  st.lastPrintClockMs = Math.max(st.lastPrintClockMs, clock);
  return clock;
}

function notionalDollars(
  kind: DeskFlowAssetKind,
  sym: string,
  price: number,
  size: number,
): { dollars: number | null; known: boolean } {
  if (kind === "futures") {
    const d = deskLiveFlowFuturesNotionalDollars(sym, price, size);
    return { dollars: d, known: d != null };
  }
  return { dollars: price * size, known: true };
}

export function deskLiveFlowTapeBucketTick(nowMs: number): void {
  for (const [sym, st] of states) {
    if (st.open1s && bucketDueToClose(st.open1s.bucket_ms, nowMs, 1000)) {
      emitTape1s(sym, st, st.open1s, nowMs, true);
      st.open1s = null;
    }
    if (st.open60s && bucketDueToClose(st.open60s.minute_ms, nowMs, 60_000)) {
      emitTape60s(sym, st, st.open60s, nowMs);
      st.open60s = null;
    }
  }
}

export function deskLiveFlowTapeOnSessionReset(): void {
  for (const st of states.values()) {
    st.timesaleSeen = false;
    st.prevVolume = null;
    st.prevQuote = null;
    st.quoteHistory = [];
    st.lastPrintSeq = null;
    st.lastPrintClockMs = 0;
    st.open1s = null;
    st.open60s = null;
  }
}

export function deskLiveFlowTapeDropSymbol(sym: string): void {
  states.delete(symKey(sym));
}

function closeOpen1s(sym: string, st: SymbolState, rxMs: number): void {
  if (!st.open1s) return;
  emitTape1s(sym, st, st.open1s, rxMs);
  st.open1s = null;
}

function addPrint(
  st: SymbolState,
  sym: string,
  side: "buy" | "sell" | "mid",
  size: number,
  price: number,
  clockMs: number,
  src: TapeBucket1s["src"],
): void {
  ensureBucketTimer();
  let bms = bucketMs1s(clockMs);
  if (st.lastEmitted1sBucketMs != null && bms < st.lastEmitted1sBucketMs) {
    if (st.open1s && st.open1s.bucket_ms >= st.lastEmitted1sBucketMs) {
      bms = st.open1s.bucket_ms;
    } else {
      bms = bucketMs1s(Math.max(clockMs, st.lastEmitted1sBucketMs + 1));
    }
  } else if (st.open1s && bms === st.open1s.bucket_ms) {
    bms = st.open1s.bucket_ms;
  }

  if (!st.open1s || st.open1s.bucket_ms !== bms) {
    if (st.open1s) closeOpen1s(sym, st, clockMs);
    st.open1s = fresh1s(bms, src);
  }
  const b = st.open1s;
  b.n_prints += 1;
  b.last = price;
  b.vwap_num += price * size;
  b.vwap_den += size;
  const { dollars, known } = notionalDollars(st.kind, sym, price, size);
  if (side === "buy") {
    b.buy_vol += size;
    if (known && dollars != null) b.buy_$ += dollars;
    else b.buy_$_known = false;
  } else if (side === "sell") {
    b.sell_vol += size;
    if (known && dollars != null) b.sell_$ += dollars;
    else b.sell_$_known = false;
  } else {
    b.mid_vol += size;
    if (known && dollars != null) b.mid_$ += dollars;
    else b.mid_$_known = false;
  }

  const mms = minuteMs(bms);
  if (st.lastEmitted60sMinuteMs != null && mms <= st.lastEmitted60sMinuteMs) return;
  if (!st.open60s || st.open60s.minute_ms !== mms) {
    if (st.open60s) emitTape60s(sym, st, st.open60s, clockMs);
    st.open60s = fresh60s(bms, src);
  }
  const m = st.open60s;
  m.n_prints += 1;
  m.last = price;
  m.vwap_num += price * size;
  m.vwap_den += size;
  if (side === "buy") {
    m.buy_vol += size;
    if (known && dollars != null) m.buy_$ += dollars;
    else m.buy_$_known = false;
  } else if (side === "sell") {
    m.sell_vol += size;
    if (known && dollars != null) m.sell_$ += dollars;
    else m.sell_$_known = false;
  } else {
    m.mid_vol += size;
    if (known && dollars != null) m.mid_$ += dollars;
    else m.mid_$_known = false;
  }
}

function dollarsField(b: TapeBucket1s, side: "buy" | "sell" | "mid"): number | null {
  if (side === "buy") return b.buy_$_known ? b.buy_$ : null;
  if (side === "sell") return b.sell_$_known ? b.sell_$ : null;
  return b.mid_$_known ? b.mid_$ : null;
}

function emitTapeHeartbeat(sym: string, bucketMs: number, rxMs: number): void {
  recordFrame(
    wrapDeskLiveFlowFrame({ type: "tape_heartbeat", sym, bucket_ms: bucketMs, empty: true, src: "desk" }, bucketMs, rxMs),
  );
}

function emitTape1s(sym: string, st: SymbolState, b: TapeBucket1s, rxMs: number, forceEmpty = false): void {
  if (st.lastEmitted1sBucketMs != null && b.bucket_ms < st.lastEmitted1sBucketMs) return;
  if (!b.n_prints) {
    if (forceEmpty) emitTapeHeartbeat(sym, b.bucket_ms, rxMs);
    return;
  }
  st.lastEmitted1sBucketMs = b.bucket_ms;
  const vwap = b.vwap_den > 0 ? b.vwap_num / b.vwap_den : b.last;
  const mult =
    st.kind === "futures" ? deskLiveFlowFuturesContractMultiplier(sym) : null;
  const payload = {
    type: "tape_1s",
    sym,
    bucket_ms: b.bucket_ms,
    buy_vol: b.buy_vol,
    sell_vol: b.sell_vol,
    mid_vol: b.mid_vol,
    buy_$: dollarsField(b, "buy"),
    sell_$: dollarsField(b, "sell"),
    mid_$: dollarsField(b, "mid"),
    futures_mult: mult,
    vwap,
    last: b.last,
    n_prints: b.n_prints,
    src: b.src,
    label: b.src === "schwab_timesale" ? "Schwab tape" : "Schwab L1 est.",
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, b.bucket_ms + 999, rxMs));
}

function emitTape60s(sym: string, st: SymbolState, b: TapeBucket60s, rxMs: number): void {
  if (st.lastEmitted60sMinuteMs != null && b.minute_ms <= st.lastEmitted60sMinuteMs) return;
  if (!b.n_prints) return;
  st.lastEmitted60sMinuteMs = b.minute_ms;
  const vwap = b.vwap_den > 0 ? b.vwap_num / b.vwap_den : b.last;
  const mult =
    st.kind === "futures" ? deskLiveFlowFuturesContractMultiplier(sym) : null;
  const payload = {
    type: "tape_60s",
    sym,
    bar_start_ms: b.minute_ms,
    buy_vol: b.buy_vol,
    sell_vol: b.sell_vol,
    mid_vol: b.mid_vol,
    buy_$: dollarsField(b, "buy"),
    sell_$: dollarsField(b, "sell"),
    mid_$: dollarsField(b, "mid"),
    futures_mult: mult,
    vwap,
    last: b.last,
    n_prints: b.n_prints,
    src: b.src,
    label: b.src === "schwab_timesale" ? "Schwab tape" : "Schwab L1 est.",
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, b.minute_ms + 59_999, rxMs));
}

function flushBookTrailing(sym: string, st: SymbolState, rxMs: number): void {
  if (!st.bookTrailing) return;
  const q = st.bookTrailing;
  st.bookTrailing = null;
  if (st.bookTrailingTimer) {
    clearTimeout(st.bookTrailingTimer);
    st.bookTrailingTimer = null;
  }
  emitBook(sym, st, q, rxMs);
}

function emitBook(sym: string, st: SymbolState, q: QuoteSnap, rxMs: number): void {
  st.lastBookEmitMs = rxMs;
  st.lastBook = { ...q };
  const asset =
    st.kind === "futures" ? "futures" : st.kind === "equity" ? "equity" : "index";
  const payload = {
    type: "book",
    sym,
    bid: q.bid,
    bid_size: q.bidSize,
    ask: q.ask,
    ask_size: q.askSize,
    asset,
    src: "schwab_l1",
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, rxMs, rxMs));
}

function maybeEmitBook(sym: string, st: SymbolState, q: QuoteSnap, rxMs: number): void {
  const merged: QuoteSnap = {
    bid: q.bid,
    ask: q.ask,
    bidSize: q.bidSize ?? st.lastBook?.bidSize ?? null,
    askSize: q.askSize ?? st.lastBook?.askSize ?? null,
    last: q.last ?? st.lastBook?.last ?? null,
  };
  const changed =
    !st.lastBook ||
    st.lastBook.bid !== merged.bid ||
    st.lastBook.ask !== merged.ask ||
    st.lastBook.bidSize !== merged.bidSize ||
    st.lastBook.askSize !== merged.askSize;
  if (!changed) return;
  const window = 1000 / DESK_LIVE_FLOW_PX_MAX_PER_SEC;
  if (rxMs - st.lastBookEmitMs < window) {
    st.bookTrailing = merged;
    if (st.bookTrailingTimer) clearTimeout(st.bookTrailingTimer);
    const delay = window - (rxMs - st.lastBookEmitMs);
    st.bookTrailingTimer = setTimeout(() => flushBookTrailing(sym, st, Date.now()), delay);
    st.bookTrailingTimer.unref?.();
    return;
  }
  emitBook(sym, st, merged, rxMs);
}

export function deskLiveFlowTapeOnTimesaleEquity(
  symbol: string,
  price: number,
  size: number,
  tradeTimeMs: number | null,
  sequence?: number | null,
): void {
  if (!deskLiveFlowEnabled()) return;
  if (!deskLiveFlowSubsSymbolActive(symbol, "equity")) return;
  const sym = symKey(symbol);
  const st = stateFor(sym, "equity");
  const rxMs = Date.now();
  const clockMs = eventClockMs(tradeTimeMs, rxMs, sequence ?? null, st);
  if (clockMs == null) return;
  const refMs = tradeTimeMs ?? clockMs;
  const q = quoteAtOrBefore(st, refMs);
  const bid = q?.bid;
  const ask = q?.ask;
  if (bid == null || ask == null || ask < bid) {
    const mid = q?.last ?? price;
    if (mid == null) return;
    st.timesaleSeen = true;
    addPrint(st, sym, "mid", size, price, clockMs, "schwab_timesale");
    return;
  }
  const side = classifyFlowAgainstPriorQuote(price, bid, ask) ?? "mid";
  st.timesaleSeen = true;
  addPrint(st, sym, side, size, price, clockMs, "schwab_timesale");
}

export function deskLiveFlowTapeOnTimesaleFutures(
  displaySymbol: string,
  price: number,
  size: number,
  tradeTimeMs: number | null,
  sequence?: number | null,
): void {
  if (!deskLiveFlowEnabled()) return;
  if (!deskLiveFlowSubsSymbolActive(displaySymbol, "futures")) return;
  const sym = displaySymbol.toUpperCase();
  const st = stateFor(sym, "futures");
  const rxMs = Date.now();
  const clockMs = eventClockMs(tradeTimeMs, rxMs, sequence ?? null, st);
  if (clockMs == null) return;
  const refMs = tradeTimeMs ?? clockMs;
  const q = quoteAtOrBefore(st, refMs);
  const bid = q?.bid;
  const ask = q?.ask;
  if (bid == null || ask == null || ask < bid) {
    st.timesaleSeen = true;
    addPrint(st, sym, "mid", size, price, clockMs, "schwab_timesale");
    return;
  }
  const side = classifyFlowAgainstPriorQuote(price, bid, ask) ?? "mid";
  st.timesaleSeen = true;
  addPrint(st, sym, side, size, price, clockMs, "schwab_timesale");
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function onL1Row(
  sym: string,
  kind: DeskFlowAssetKind,
  item: Record<string, unknown>,
  rxMs: number,
): void {
  if (!deskLiveFlowEnabled()) return;
  if (!deskLiveFlowSubsSymbolActive(sym, kind)) return;
  const st = stateFor(sym, kind);
  const bid = num(item["1"]) ?? st.prevQuote?.bid ?? null;
  const ask = num(item["2"]) ?? st.prevQuote?.ask ?? null;
  const last = num(item["3"]) ?? st.prevQuote?.last ?? null;
  const bidSize = num(item["4"]) ?? st.lastBook?.bidSize ?? null;
  const askSize = num(item["5"]) ?? st.lastBook?.askSize ?? null;
  const vol = num(item["8"]);
  const quoteMs = num(item["34"]) ?? rxMs;

  if (bid != null && ask != null && ask >= bid) {
    const q: QuoteSnap = { bid, ask, bidSize, askSize, last };
    maybeEmitBook(sym, st, q, rxMs);
    const prevVol = st.prevVolume;
    const quoteForClassify = st.prevQuote;

    if (vol != null && prevVol != null && !st.timesaleSeen) {
      const dVol = vol - prevVol;
      if (dVol > 0 && last != null && quoteForClassify) {
        const side = classifyFlowAgainstPriorQuote(last, quoteForClassify.bid, quoteForClassify.ask);
        if (side) {
          st.l1Fallback = true;
          const clock = eventClockMs(quoteMs, rxMs, null, st);
          if (clock != null) addPrint(st, sym, side, dVol, last, clock, "schwab_l1_est");
        }
      } else if (dVol < 0) {
        /* out-of-order volume: keep baseline */
      }
    }

    pushQuoteHistory(st, q, quoteMs);
    st.prevQuote = q;
    if (vol != null && (prevVol == null || vol >= prevVol)) st.prevVolume = vol;
  }
}

export function deskLiveFlowTapeOnEquityL1(sym: string, item: Record<string, unknown>, rxMs: number): void {
  onL1Row(sym, "equity", item, rxMs);
}

export function deskLiveFlowTapeOnFuturesL1(displaySym: string, item: Record<string, unknown>, rxMs: number): void {
  onL1Row(displaySym.toUpperCase(), "futures", item, rxMs);
}

export function deskLiveFlowTapeEmitNotice(sym: string, code: string, message: string, rxMs = Date.now()): void {
  const payload = {
    type: "flow_notice",
    sym,
    code,
    message,
    src: "desk",
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, rxMs, rxMs));
}

export function deskLiveFlowTapeFlush(sym: string, rxMs: number): void {
  const st = states.get(symKey(sym));
  if (!st) return;
  if (st.open1s) {
    emitTape1s(sym, st, st.open1s, rxMs);
    st.open1s = null;
  }
  if (st.open60s) {
    emitTape60s(sym, st, st.open60s, rxMs);
    st.open60s = null;
  }
}

export function deskLiveFlowTapeResetForTests(): void {
  states.clear();
  bucketsHooked = false;
}

export function deskLiveFlowTapeReplayPrints(
  sym: string,
  kind: DeskFlowAssetKind,
  prints: Array<{ price: number; size: number; rxMs: number; bid: number; ask: number; tradeMs?: number; seq?: number }>,
): DeskLiveFlowFrame[] {
  const before = deskLiveFlowTestFrameCount();
  const st = stateFor(sym, kind);
  for (const p of prints) {
    const quoteMs = p.tradeMs ?? p.rxMs;
    pushQuoteHistory(st, { bid: p.bid, ask: p.ask, bidSize: null, askSize: null, last: p.price }, quoteMs);
    st.prevQuote = { bid: p.bid, ask: p.ask, bidSize: null, askSize: null, last: p.price };
    const clock = eventClockMs(p.tradeMs ?? null, p.rxMs, p.seq ?? null, st);
    if (clock == null) continue;
    const side = classifyFlowAgainstPriorQuote(p.price, p.bid, p.ask);
    if (!side) continue;
    addPrint(st, symKey(sym), side, p.size, p.price, clock, "schwab_timesale");
  }
  deskLiveFlowTapeFlush(sym, prints.at(-1)?.rxMs ?? Date.now());
  return deskLiveFlowTestSliceFrames(before);
}