import { classifyFlowAgainstPriorQuote } from "./deskLiveFlowClassify.js";
import {
  deskLiveFlowBroadcastFrame,
  wrapDeskLiveFlowFrame,
  type DeskLiveFlowFrame,
} from "./deskLiveFlowHub.js";
import { DESK_LIVE_FLOW_PX_MAX_PER_SEC, deskLiveFlowEnabled } from "./deskLiveFlowConfig.js";
import type { DeskFlowAssetKind } from "./deskLiveFlowSymbol.js";
import { deskLiveFlowSubsSymbolActive } from "./deskLiveFlowSubs.js";

type TapeBucket1s = {
  bucket_ms: number;
  buy_vol: number;
  sell_vol: number;
  mid_vol: number;
  buy_$: number;
  sell_$: number;
  mid_$: number;
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

type SymbolState = {
  kind: DeskFlowAssetKind;
  prevQuote: QuoteSnap | null;
  prevVolume: number | null;
  open1s: TapeBucket1s | null;
  open60s: TapeBucket60s | null;
  lastBookEmitMs: number;
  lastBook: QuoteSnap | null;
  timesaleSeen: boolean;
  l1Fallback: boolean;
};

const states = new Map<string, SymbolState>();
const emittedFrames: DeskLiveFlowFrame[] = [];

function bucketMs1s(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

function minuteMs(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
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
      open1s: null,
      open60s: null,
      lastBookEmitMs: 0,
      lastBook: null,
      timesaleSeen: false,
      l1Fallback: false,
    };
    states.set(k, s);
  }
  return s;
}

function addPrint(
  st: SymbolState,
  sym: string,
  side: "buy" | "sell" | "mid",
  size: number,
  price: number,
  rxMs: number,
  src: TapeBucket1s["src"],
): void {
  const bms = bucketMs1s(rxMs);
  if (!st.open1s || st.open1s.bucket_ms !== bms) {
    if (st.open1s) emitTape1s(sym, st.open1s, rxMs);
    st.open1s = fresh1s(bms, src);
  }
  const b = st.open1s;
  b.n_prints += 1;
  b.last = price;
  b.vwap_num += price * size;
  b.vwap_den += size;
  const dollars = price * size;
  if (side === "buy") {
    b.buy_vol += size;
    b.buy_$ += dollars;
  } else if (side === "sell") {
    b.sell_vol += size;
    b.sell_$ += dollars;
  } else {
    b.mid_vol += size;
    b.mid_$ += dollars;
  }

  const mms = minuteMs(bms);
  if (!st.open60s || st.open60s.minute_ms !== mms) {
    if (st.open60s) emitTape60s(sym, st.open60s, rxMs);
    st.open60s = fresh60s(bms, src);
  }
  const m = st.open60s;
  m.n_prints += 1;
  m.last = price;
  m.vwap_num += price * size;
  m.vwap_den += size;
  if (side === "buy") {
    m.buy_vol += size;
    m.buy_$ += dollars;
  } else if (side === "sell") {
    m.sell_vol += size;
    m.sell_$ += dollars;
  } else {
    m.mid_vol += size;
    m.mid_$ += dollars;
  }
}

function emitTape1s(sym: string, b: TapeBucket1s, rxMs: number): void {
  if (!b.n_prints) return;
  const vwap = b.vwap_den > 0 ? b.vwap_num / b.vwap_den : b.last;
  const payload = {
    type: "tape_1s",
    sym,
    bucket_ms: b.bucket_ms,
    buy_vol: b.buy_vol,
    sell_vol: b.sell_vol,
    mid_vol: b.mid_vol,
    buy_$: b.buy_$,
    sell_$: b.sell_$,
    mid_$: b.mid_$,
    vwap,
    last: b.last,
    n_prints: b.n_prints,
    src: b.src,
    label: b.src === "schwab_timesale" ? "Schwab tape" : "Schwab L1 est.",
  };
  const frame = wrapDeskLiveFlowFrame(payload, b.bucket_ms + 999, rxMs);
  emittedFrames.push(frame);
  deskLiveFlowBroadcastFrame(frame);
}

function emitTape60s(sym: string, b: TapeBucket60s, rxMs: number): void {
  if (!b.n_prints) return;
  const vwap = b.vwap_den > 0 ? b.vwap_num / b.vwap_den : b.last;
  const payload = {
    type: "tape_60s",
    sym,
    bar_start_ms: b.minute_ms,
    buy_vol: b.buy_vol,
    sell_vol: b.sell_vol,
    mid_vol: b.mid_vol,
    buy_$: b.buy_$,
    sell_$: b.sell_$,
    mid_$: b.mid_$,
    vwap,
    last: b.last,
    n_prints: b.n_prints,
    src: b.src,
    label: b.src === "schwab_timesale" ? "Schwab tape" : "Schwab L1 est.",
  };
  const frame = wrapDeskLiveFlowFrame(payload, b.minute_ms + 59_999, rxMs);
  emittedFrames.push(frame);
  deskLiveFlowBroadcastFrame(frame);
}

function maybeEmitBook(sym: string, q: QuoteSnap, rxMs: number): void {
  const st = stateFor(sym, "equity");
  const changed =
    !st.lastBook ||
    st.lastBook.bid !== q.bid ||
    st.lastBook.ask !== q.ask ||
    st.lastBook.bidSize !== q.bidSize ||
    st.lastBook.askSize !== q.askSize;
  if (!changed) return;
  const window = 1000 / DESK_LIVE_FLOW_PX_MAX_PER_SEC;
  if (rxMs - st.lastBookEmitMs < window) return;
  st.lastBookEmitMs = rxMs;
  st.lastBook = { ...q };
  const payload = {
    type: "book",
    sym,
    bid: q.bid,
    bid_size: q.bidSize,
    ask: q.ask,
    ask_size: q.askSize,
    src: "schwab_l1",
  };
  const frame = wrapDeskLiveFlowFrame(payload, rxMs, rxMs);
  emittedFrames.push(frame);
  deskLiveFlowBroadcastFrame(frame);
}

export function deskLiveFlowTapeOnTimesaleEquity(
  symbol: string,
  price: number,
  size: number,
  tradeTimeMs: number | null,
): void {
  if (!deskLiveFlowEnabled()) return;
  if (!deskLiveFlowSubsSymbolActive(symbol, "equity")) return;
  const sym = symKey(symbol);
  const st = stateFor(sym, "equity");
  const rxMs = tradeTimeMs ?? Date.now();
  const bid = st.prevQuote?.bid;
  const ask = st.prevQuote?.ask;
  if (bid == null || ask == null || ask < bid) return;
  const side = classifyFlowAgainstPriorQuote(price, bid, ask);
  st.timesaleSeen = true;
  addPrint(st, sym, side, size, price, rxMs, "schwab_timesale");
}

export function deskLiveFlowTapeOnTimesaleFutures(
  displaySymbol: string,
  price: number,
  size: number,
  tradeTimeMs: number | null,
): void {
  if (!deskLiveFlowEnabled()) return;
  if (!deskLiveFlowSubsSymbolActive(displaySymbol, "futures")) return;
  const sym = displaySymbol.toUpperCase();
  const st = stateFor(sym, "futures");
  const rxMs = tradeTimeMs ?? Date.now();
  const bid = st.prevQuote?.bid;
  const ask = st.prevQuote?.ask;
  if (bid == null || ask == null || ask < bid) return;
  const side = classifyFlowAgainstPriorQuote(price, bid, ask);
  st.timesaleSeen = true;
  addPrint(st, sym, side, size, price, rxMs, "schwab_timesale");
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function deskLiveFlowTapeOnEquityL1(sym: string, item: Record<string, unknown>, rxMs: number): void {
  if (!deskLiveFlowEnabled()) return;
  if (!deskLiveFlowSubsSymbolActive(sym, "equity")) return;
  const st = stateFor(sym, "equity");
  const bid = num(item["1"]) ?? st.prevQuote?.bid ?? null;
  const ask = num(item["2"]) ?? st.prevQuote?.ask ?? null;
  const last = num(item["3"]) ?? st.prevQuote?.last ?? null;
  const bidSize = num(item["4"]);
  const askSize = num(item["5"]);
  const vol = num(item["8"]);

  if (bid != null && ask != null) {
    const q: QuoteSnap = { bid, ask, bidSize, askSize, last };
    maybeEmitBook(sym, q, rxMs);
    const prev = st.prevQuote;
    st.prevQuote = q;

    if (vol != null && prev && st.prevVolume != null && !st.timesaleSeen) {
      const dVol = vol - st.prevVolume;
      if (dVol > 0 && last != null && prev.bid != null && prev.ask != null) {
        st.l1Fallback = true;
        const side = classifyFlowAgainstPriorQuote(last, prev.bid, prev.ask);
        addPrint(st, sym, side, dVol, last, rxMs, "schwab_l1_est");
      } else if (dVol < 0) {
        st.prevVolume = vol;
      }
    }
    if (vol != null) st.prevVolume = vol;
    return;
  }

  if (vol != null && st.prevQuote && st.prevVolume != null && last != null && !st.timesaleSeen) {
    const dVol = vol - st.prevVolume;
    if (dVol > 0) {
      st.l1Fallback = true;
      const side = classifyFlowAgainstPriorQuote(last, st.prevQuote.bid, st.prevQuote.ask);
      addPrint(st, sym, side, dVol, last, rxMs, "schwab_l1_est");
    }
    st.prevVolume = vol;
  }
}

export function deskLiveFlowTapeOnFuturesL1(displaySym: string, item: Record<string, unknown>, rxMs: number): void {
  if (!deskLiveFlowEnabled()) return;
  const sym = displaySym.toUpperCase();
  if (!deskLiveFlowSubsSymbolActive(sym, "futures")) return;
  const st = stateFor(sym, "futures");
  const bid = num(item["1"]) ?? st.prevQuote?.bid ?? null;
  const ask = num(item["2"]) ?? st.prevQuote?.ask ?? null;
  const last = num(item["3"]) ?? st.prevQuote?.last ?? null;
  const bidSize = num(item["4"]);
  const askSize = num(item["5"]);
  const vol = num(item["8"]);

  if (bid != null && ask != null) {
    const q: QuoteSnap = { bid, ask, bidSize, askSize, last };
    maybeEmitBook(sym, q, rxMs);
    const prev = st.prevQuote;
    st.prevQuote = q;

    if (vol != null && prev && st.prevVolume != null && !st.timesaleSeen) {
      const dVol = vol - st.prevVolume;
      if (dVol > 0 && last != null && prev.bid != null && prev.ask != null) {
        const side = classifyFlowAgainstPriorQuote(last, prev.bid, prev.ask);
        addPrint(st, sym, side, dVol, last, rxMs, "schwab_l1_est");
      }
    }
    if (vol != null) st.prevVolume = vol;
  }
}

export function deskLiveFlowTapeEmitNotice(sym: string, code: string, message: string, rxMs = Date.now()): void {
  const payload = {
    type: "flow_notice",
    sym,
    code,
    message,
    src: "desk",
  };
  const frame = wrapDeskLiveFlowFrame(payload, rxMs, rxMs);
  deskLiveFlowBroadcastFrame(frame);
}

export function deskLiveFlowTapeFlush(sym: string, rxMs: number): void {
  const st = states.get(symKey(sym));
  if (!st) return;
  if (st.open1s) {
    emitTape1s(sym, st.open1s, rxMs);
    st.open1s = null;
  }
  if (st.open60s) {
    emitTape60s(sym, st.open60s, rxMs);
    st.open60s = null;
  }
}

export function deskLiveFlowTapeResetForTests(): void {
  states.clear();
  emittedFrames.length = 0;
}

export function deskLiveFlowTapeReplayPrints(
  sym: string,
  kind: DeskFlowAssetKind,
  prints: Array<{ price: number; size: number; rxMs: number; bid: number; ask: number }>,
): DeskLiveFlowFrame[] {
  const before = emittedFrames.length;
  const st = stateFor(sym, kind);
  for (const p of prints) {
    st.prevQuote = { bid: p.bid, ask: p.ask, bidSize: null, askSize: null, last: p.price };
    const side = classifyFlowAgainstPriorQuote(p.price, p.bid, p.ask);
    addPrint(st, symKey(sym), side, p.size, p.price, p.rxMs, "schwab_timesale");
  }
  deskLiveFlowTapeFlush(sym, prints.at(-1)?.rxMs ?? Date.now());
  return emittedFrames.slice(before);
}