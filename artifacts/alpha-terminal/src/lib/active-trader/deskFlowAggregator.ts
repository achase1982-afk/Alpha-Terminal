import type { AtGlanceMode } from "./atGlanceMode";
import type {
  DeskFlow60s,
  DeskFlow1s,
  DeskFlowFrame,
  DeskPxFrame,
  DeskTape1s,
  DeskTape60s,
} from "./deskFlowFrameTypes";

const MS_1M = 60_000;
const MS_5M = 5 * MS_1M;

export type DeskIndexFlowTotals = {
  callBuy1m: number;
  callSell1m: number;
  putBuy1m: number;
  putSell1m: number;
  callBuy5m: number;
  callSell5m: number;
  putBuy5m: number;
  putSell5m: number;
  callBuyHr: number;
  callSellHr: number;
  putBuyHr: number;
  putSellHr: number;
};

export type DeskTapeTotals = {
  lift1m: number;
  hit1m: number;
  lift5m: number;
  hit5m: number;
  liftHr: number;
  hitHr: number;
};

export type DeskFlowLivePx = {
  last: number | null;
  bid: number | null;
  ask: number | null;
  srcTsMs: number;
};

export type DeskFlowConnection =
  | "idle"
  | "connecting"
  | "live"
  | "no_prints"
  | "offline"
  | "unsupported";

export type DeskFlowAggregate = {
  mode: AtGlanceMode;
  connection: DeskFlowConnection;
  index: DeskIndexFlowTotals | null;
  tape: DeskTapeTotals | null;
  livePx: DeskFlowLivePx | null;
  lastRxMs: number | null;
};

type Flow1sBucket = Pick<DeskFlow1s, "bucket_ms" | "call_buy" | "call_sell" | "put_buy" | "put_sell">;
type Flow60sBar = Pick<DeskFlow60s, "bar_start_ms" | "call_buy" | "call_sell" | "put_buy" | "put_sell">;
type Tape1sBucket = Pick<DeskTape1s, "bucket_ms" | "buy_$" | "sell_$" | "n_prints">;
type Tape60sBar = Pick<DeskTape60s, "bar_start_ms" | "buy_$" | "sell_$" | "n_prints">;

type Internal = {
  mode: AtGlanceMode;
  nowMs: number;
  connected: boolean;
  hadNonEmptyPrint: boolean;
  flow1s: Flow1sBucket[];
  flow60s: Flow60sBar[];
  tape1s: Tape1sBucket[];
  tape60s: Tape60sBar[];
  livePx: DeskFlowLivePx | null;
  lastRxMs: number | null;
};

function sumIndexBars(bars: Flow60sBar[], field: keyof Flow60sBar): number {
  let n = 0;
  for (const b of bars) {
    const v = b[field];
    if (typeof v === "number" && Number.isFinite(v)) n += v;
  }
  return n;
}

function sumTapeBars(bars: Tape60sBar[], field: "buy_$" | "sell_$"): number {
  let n = 0;
  for (const b of bars) {
    const v = b[field];
    if (typeof v === "number" && Number.isFinite(v)) n += v;
  }
  return n;
}

function sumFlow1sWindow(buckets: Flow1sBucket[], nowMs: number, windowMs: number): Flow1sBucket {
  const minMs = nowMs - windowMs;
  const out: Flow1sBucket = { bucket_ms: minMs, call_buy: 0, call_sell: 0, put_buy: 0, put_sell: 0 };
  for (const b of buckets) {
    if (b.bucket_ms < minMs) continue;
    out.call_buy! += b.call_buy ?? 0;
    out.call_sell! += b.call_sell ?? 0;
    out.put_buy! += b.put_buy ?? 0;
    out.put_sell! += b.put_sell ?? 0;
  }
  return out;
}

function sumTape1sWindow(buckets: Tape1sBucket[], nowMs: number, windowMs: number): { buy: number; sell: number } {
  const minMs = nowMs - windowMs;
  let buy = 0;
  let sell = 0;
  for (const b of buckets) {
    if (b.bucket_ms < minMs) continue;
    buy += b.buy_$ ?? 0;
    sell += b.sell_$ ?? 0;
  }
  return { buy, sell };
}

function hourStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function flow60sInRange(bars: Flow60sBar[], startMs: number, endMs: number): Flow60sBar[] {
  return bars.filter((b) => b.bar_start_ms >= startMs && b.bar_start_ms < endMs);
}

function tape60sInRange(bars: Tape60sBar[], startMs: number, endMs: number): Tape60sBar[] {
  return bars.filter((b) => b.bar_start_ms >= startMs && b.bar_start_ms < endMs);
}

function trimBuckets1s<T extends { bucket_ms: number }>(rows: T[], nowMs: number, keepMs: number): T[] {
  const min = nowMs - keepMs;
  return rows.filter((r) => r.bucket_ms >= min).slice(-400);
}

function trimBars60s<T extends { bar_start_ms: number }>(rows: T[], nowMs: number, keepMs: number): T[] {
  const min = nowMs - keepMs;
  return rows.filter((r) => r.bar_start_ms >= min).slice(-120);
}

export function createDeskFlowAggregator(mode: AtGlanceMode, nowMs = Date.now()): DeskFlowAggregate {
  return deskFlowAggregatorProject(createDeskFlowAggregatorInternal(mode, nowMs));
}

function bucketHasFlow(b: Flow1sBucket | Flow60sBar): boolean {
  return (
    (b.call_buy ?? 0) !== 0
    || (b.call_sell ?? 0) !== 0
    || (b.put_buy ?? 0) !== 0
    || (b.put_sell ?? 0) !== 0
  );
}

function bucketHasTape(b: Tape1sBucket | Tape60sBar): boolean {
  return (b.n_prints ?? 0) > 0 || (b.buy_$ ?? 0) !== 0 || (b.sell_$ ?? 0) !== 0;
}

export function reduceDeskFlowFrame(state: Internal, frame: DeskFlowFrame): Internal {
  const rx = frame.rx_ts_ms ?? Date.now();
  const next: Internal = { ...state, nowMs: rx, lastRxMs: rx };

  if (frame.type === "px") {
    const px = frame as DeskPxFrame;
    const srcTs = px.src_ts_ms ?? rx;
    const last = px.last ?? null;
    const bid = px.bid ?? null;
    const ask = px.ask ?? null;
    if (last != null || bid != null || ask != null) {
      next.livePx = { last, bid, ask, srcTsMs: srcTs };
    }
    return next;
  }

  if (frame.type === "flow_1s") {
    const f = frame as DeskFlow1s;
    const row: Flow1sBucket = {
      bucket_ms: f.bucket_ms,
      call_buy: f.call_buy,
      call_sell: f.call_sell,
      put_buy: f.put_buy,
      put_sell: f.put_sell,
    };
    next.flow1s = trimBuckets1s([...next.flow1s.filter((x) => x.bucket_ms !== f.bucket_ms), row], rx, MS_5M + MS_1M);
    if (bucketHasFlow(row)) next.hadNonEmptyPrint = true;
    return next;
  }

  if (frame.type === "flow_60s") {
    const f = frame as DeskFlow60s;
    const row: Flow60sBar = {
      bar_start_ms: f.bar_start_ms,
      call_buy: f.call_buy,
      call_sell: f.call_sell,
      put_buy: f.put_buy,
      put_sell: f.put_sell,
    };
    next.flow60s = trimBars60s([...next.flow60s.filter((x) => x.bar_start_ms !== f.bar_start_ms), row], rx, 2 * 3_600_000);
    if (bucketHasFlow(row)) next.hadNonEmptyPrint = true;
    return next;
  }

  if (frame.type === "tape_1s") {
    const t = frame as DeskTape1s;
    const row: Tape1sBucket = {
      bucket_ms: t.bucket_ms,
      buy_$: t.buy_$ ?? 0,
      sell_$: t.sell_$ ?? 0,
      n_prints: t.n_prints,
    };
    next.tape1s = trimBuckets1s([...next.tape1s.filter((x) => x.bucket_ms !== t.bucket_ms), row], rx, MS_5M + MS_1M);
    if (bucketHasTape(row)) next.hadNonEmptyPrint = true;
    return next;
  }

  if (frame.type === "tape_60s") {
    const t = frame as DeskTape60s;
    const row: Tape60sBar = {
      bar_start_ms: t.bar_start_ms,
      buy_$: t.buy_$ ?? 0,
      sell_$: t.sell_$ ?? 0,
      n_prints: t.n_prints,
    };
    next.tape60s = trimBars60s([...next.tape60s.filter((x) => x.bar_start_ms !== t.bar_start_ms), row], rx, 2 * 3_600_000);
    if (bucketHasTape(row)) next.hadNonEmptyPrint = true;
    return next;
  }

  return next;
}

export function deskFlowAggregatorMarkConnected(state: Internal, connected: boolean): Internal {
  return { ...state, connected };
}

export function deskFlowAggregatorMarkUnsupported(state: Internal): DeskFlowAggregate {
  return {
    mode: state.mode,
    connection: "unsupported",
    index: null,
    tape: null,
    livePx: state.livePx,
    lastRxMs: state.lastRxMs,
  };
}

function project(state: Internal): DeskFlowAggregate {
  const { mode, nowMs, connected, hadNonEmptyPrint } = state;
  let connection: DeskFlowConnection = "idle";
  if (!connected) connection = "offline";
  else if (!hadNonEmptyPrint) connection = "no_prints";
  else connection = "live";

  const m1 = sumFlow1sWindow(state.flow1s, nowMs, MS_1M);
  const recent5 = flow60sInRange(state.flow60s, nowMs - MS_5M, nowMs + 1);
  const hrBars = flow60sInRange(state.flow60s, hourStartMs(nowMs), nowMs + MS_1M);

  const index: DeskIndexFlowTotals | null =
    mode === "index"
      ? {
          callBuy1m: m1.call_buy ?? 0,
          callSell1m: m1.call_sell ?? 0,
          putBuy1m: m1.put_buy ?? 0,
          putSell1m: m1.put_sell ?? 0,
          callBuy5m: sumIndexBars(recent5, "call_buy"),
          callSell5m: sumIndexBars(recent5, "call_sell"),
          putBuy5m: sumIndexBars(recent5, "put_buy"),
          putSell5m: sumIndexBars(recent5, "put_sell"),
          callBuyHr: sumIndexBars(hrBars, "call_buy"),
          callSellHr: sumIndexBars(hrBars, "call_sell"),
          putBuyHr: sumIndexBars(hrBars, "put_buy"),
          putSellHr: sumIndexBars(hrBars, "put_sell"),
        }
      : null;

  const tape1m = sumTape1sWindow(state.tape1s, nowMs, MS_1M);
  const tape5 = tape60sInRange(state.tape60s, nowMs - MS_5M, nowMs + 1);
  const tapeHr = tape60sInRange(state.tape60s, hourStartMs(nowMs), nowMs + MS_1M);
  const tape: DeskTapeTotals | null =
    mode === "stock" || mode === "futures"
      ? {
          lift1m: tape1m.buy,
          hit1m: tape1m.sell,
          lift5m: sumTapeBars(tape5, "buy_$"),
          hit5m: sumTapeBars(tape5, "sell_$"),
          liftHr: sumTapeBars(tapeHr, "buy_$"),
          hitHr: sumTapeBars(tapeHr, "sell_$"),
        }
      : null;

  if (connected && hadNonEmptyPrint) connection = "live";
  else if (connected) connection = "no_prints";

  return {
    mode,
    connection,
    index,
    tape,
    livePx: state.livePx,
    lastRxMs: state.lastRxMs,
  };
}

export function deskFlowAggregatorProject(state: Internal): DeskFlowAggregate {
  return project(state);
}

export function createDeskFlowAggregatorInternal(mode: AtGlanceMode, nowMs = Date.now()): Internal {
  return {
    mode,
    nowMs,
    connected: false,
    hadNonEmptyPrint: false,
    flow1s: [],
    flow60s: [],
    tape1s: [],
    tape60s: [],
    livePx: null,
    lastRxMs: null,
  };
}

export type DeskFlowAggregatorInternal = Internal;