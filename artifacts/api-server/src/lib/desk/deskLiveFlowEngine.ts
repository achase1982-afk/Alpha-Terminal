import {
  applyL1oFlowTick,
  parseL1oSchwabRow,
  type ContractFlowState,
  type FlowIncrement,
} from "./deskLiveFlowClassify.js";
import { deskLiveFlowOptionSide, deskLiveFlowIsSpxOptionKey } from "./deskLiveFlowOcc.js";
import { deskLiveFlowSubsSymbolActive } from "./deskLiveFlowSubs.js";
import { parseOccUnderlyingRoot } from "../streamerSubPlanSort.js";
import {
  deskLiveFlowBroadcastFrame,
  wrapDeskLiveFlowFrame,
  type DeskLiveFlowFrame,
} from "./deskLiveFlowHub.js";
import {
  DESK_LIVE_FLOW_PX_MAX_PER_SEC,
  deskLiveFlowL1oEnabled,
  deskLiveFlowPxEnabled,
  deskLiveFlowUwBarsEnabled,
} from "./deskLiveFlowConfig.js";
import { deskLiveFlowMapUwNetPremRow } from "./deskLiveFlowUwMap.js";
import {
  deskLiveFlowTestFrameCount,
  deskLiveFlowTestRecordFrame,
  deskLiveFlowTestSliceFrames,
} from "./deskLiveFlowTestBuffer.js";
import {
  bucketDueToClose,
  bucketMs1s,
  deskLiveFlowBucketsRegister,
  minuteMs,
} from "./deskLiveFlowBuckets.js";
import {
  deskLiveFlowSessionDropContracts,
  deskLiveFlowSessionMarkConnection,
  deskLiveFlowSessionMarkSessionDate,
  deskLiveFlowSessionRebaselineContracts,
  deskLiveFlowSessionResetContracts,
} from "./deskLiveFlowSession.js";
import { deskSessionDateEt } from "./deskEt.js";

type Bucket1s = {
  bucket_ms: number;
  call_buy: number;
  call_sell: number;
  call_mid: number;
  put_buy: number;
  put_sell: number;
  put_mid: number;
  n_l1o_updates: number;
  n_increments: number;
  n_contracts: Set<string>;
};

type Bucket60s = {
  minute_ms: number;
  call_buy: number;
  call_sell: number;
  call_mid: number;
  put_buy: number;
  put_sell: number;
  put_mid: number;
  n_l1o_updates: number;
  n_increments: number;
  n_contracts: Set<string>;
};

type OpenFlow = {
  b1: Bucket1s | null;
  b60: Bucket60s | null;
  lastEmitted60sMinuteMs: number | null;
};

const contractState = new Map<string, ContractFlowState>();
const openBySym = new Map<string, OpenFlow>();
let lastIdleFlowHeartbeatBucketMs: number | null = null;

type DayBook = {
  sessionDate: string;
  call_buy: number;
  call_sell: number;
  put_buy: number;
  put_sell: number;
};

/** Running option premium for the ET calendar day. Survives streamer reconnects. */
const dayBook = new Map<string, DayBook>();

function dayBookFor(sym: string, rxMs: number): DayBook {
  const sessionDate = deskSessionDateEt(new Date(rxMs));
  let book = dayBook.get(sym);
  if (!book || book.sessionDate !== sessionDate) {
    book = { sessionDate, call_buy: 0, call_sell: 0, put_buy: 0, put_sell: 0 };
    dayBook.set(sym, book);
  }
  return book;
}

function addDayDollars(
  sym: string,
  field: "call_buy" | "call_sell" | "put_buy" | "put_sell",
  dollars: number,
  rxMs: number,
): void {
  if (!dollars) return;
  dayBookFor(sym, rxMs)[field] += dollars;
}

function dayFields(sym: string, rxMs: number): {
  day_session_date: string;
  day_call_buy: number;
  day_call_sell: number;
  day_put_buy: number;
  day_put_sell: number;
} {
  const book = dayBookFor(sym, rxMs);
  return {
    day_session_date: book.sessionDate,
    day_call_buy: book.call_buy,
    day_call_sell: book.call_sell,
    day_put_buy: book.put_buy,
    day_put_sell: book.put_sell,
  };
}

/** Absolute day total for a subscriber that connects after prints have already accumulated. */
export function deskLiveFlowPublishDaySnapshot(sym: string, rxMs = Date.now()): void {
  const key = sym.trim().toUpperCase().replace(/^\$/, "") || "SPX";
  const book = dayBook.get(key);
  const sessionDate = book?.sessionDate ?? deskSessionDateEt(new Date(rxMs));
  recordFrame(
    wrapDeskLiveFlowFrame(
      {
        type: "flow_day",
        sym: key,
        session_date: sessionDate,
        call_buy: book?.call_buy ?? 0,
        call_sell: book?.call_sell ?? 0,
        put_buy: book?.put_buy ?? 0,
        put_sell: book?.put_sell ?? 0,
      },
      rxMs,
      rxMs,
    ),
  );
}

function openFlow(sym: string): OpenFlow {
  let slot = openBySym.get(sym);
  if (!slot) {
    slot = { b1: null, b60: null, lastEmitted60sMinuteMs: null };
    openBySym.set(sym, slot);
  }
  return slot;
}

/** SPX/SPXW stay on the SPX tape. Other roots only when that equity flow subscription is live. */
function optionFlowSymbol(key: string): string | null {
  if (deskLiveFlowIsSpxOptionKey(key)) return "SPX";
  const root = parseOccUnderlyingRoot(key);
  if (!root || !deskLiveFlowSubsSymbolActive(root, "equity")) return null;
  return root;
}

const UW_BAR_MAP_CAP = 512;

let lastPx: { last: number | null; bid: number | null; ask: number | null } = {
  last: null,
  bid: null,
  ask: null,
};
let pxWindowStartMs = 0;
let pxEmitsInWindow = 0;
let pxTrailing: { last: number | null; bid: number | null; ask: number | null; srcTs: number } | null = null;
let pxTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmittedPxSrcTs = 0;

const uwBarByKey = new Map<string, ReturnType<typeof deskLiveFlowMapUwNetPremRow>>();

let bucketsHooked = false;

function ensureBucketTimer(): void {
  if (bucketsHooked) return;
  bucketsHooked = true;
  deskLiveFlowBucketsRegister((now) => deskLiveFlowBucketTick(now));
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function freshBucket1s(ms: number): Bucket1s {
  return {
    bucket_ms: bucketMs1s(ms),
    call_buy: 0,
    call_sell: 0,
    call_mid: 0,
    put_buy: 0,
    put_sell: 0,
    put_mid: 0,
    n_l1o_updates: 0,
    n_increments: 0,
    n_contracts: new Set(),
  };
}

function freshBucket60s(ms: number): Bucket60s {
  return {
    minute_ms: minuteMs(ms),
    call_buy: 0,
    call_sell: 0,
    call_mid: 0,
    put_buy: 0,
    put_sell: 0,
    put_mid: 0,
    n_l1o_updates: 0,
    n_increments: 0,
    n_contracts: new Set(),
  };
}

function recordFrame(frame: DeskLiveFlowFrame): void {
  deskLiveFlowTestRecordFrame(frame);
  deskLiveFlowBroadcastFrame(frame);
}

function emitFlowHeartbeat(bucketMs: number, rxMs: number, empty: boolean): void {
  const payload = {
    type: "flow_heartbeat",
    sym: "SPX",
    bucket_ms: bucketMs,
    empty,
    src: "desk",
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, bucketMs, rxMs));
}

function applyIncrementToBuckets(inc: FlowIncrement, hadL1oFrame: boolean, sym: string): void {
  ensureBucketTimer();
  const slot = openFlow(sym);
  const bms = bucketMs1s(inc.rxMs);
  if (!slot.b1 || slot.b1.bucket_ms !== bms) {
    if (slot.b1) emitFlow1s(sym, slot.b1, inc.rxMs);
    slot.b1 = freshBucket1s(bms);
  }
  const sideKey = `${inc.optionSide}_${inc.side}` as const;
  const map: Record<string, keyof Pick<Bucket1s, "call_buy" | "call_sell" | "call_mid" | "put_buy" | "put_sell" | "put_mid">> = {
    call_buy: "call_buy",
    call_sell: "call_sell",
    call_mid: "call_mid",
    put_buy: "put_buy",
    put_sell: "put_sell",
    put_mid: "put_mid",
  };
  const field = map[sideKey];
  if (field) slot.b1[field] += inc.dollars;
  if (field === "call_buy" || field === "call_sell" || field === "put_buy" || field === "put_sell") {
    addDayDollars(sym, field, inc.dollars, inc.rxMs);
  }
  if (hadL1oFrame) slot.b1.n_l1o_updates += 1;
  slot.b1.n_increments += 1;
  slot.b1.n_contracts.add(inc.key);

  const mms = minuteMs(bms);
  if (!slot.b60 || slot.b60.minute_ms !== mms) {
    if (slot.b60) emitFlow60s(sym, slot, slot.b60, inc.rxMs);
    slot.b60 = freshBucket60s(bms);
  }
  const field60 = map[sideKey];
  if (field60) slot.b60[field60] += inc.dollars;
  if (hadL1oFrame) slot.b60.n_l1o_updates += 1;
  slot.b60.n_increments += 1;
  slot.b60.n_contracts.add(inc.key);
}

function emitFlow1s(sym: string, b: Bucket1s, rxMs: number): void {
  const has =
    b.call_buy || b.call_sell || b.call_mid || b.put_buy || b.put_sell || b.put_mid || b.n_increments > 0;
  if (!has) {
    if (sym === "SPX") emitFlowHeartbeat(b.bucket_ms, rxMs, true);
    return;
  }
  const payload = {
    type: "flow_1s",
    sym,
    bucket_ms: b.bucket_ms,
    call_buy: b.call_buy,
    call_sell: b.call_sell,
    call_mid: b.call_mid,
    put_buy: b.put_buy,
    put_sell: b.put_sell,
    put_mid: b.put_mid,
    n_l1o_updates: b.n_l1o_updates,
    n_increments: b.n_increments,
    n_contracts: b.n_contracts.size,
    src: "schwab_l1o",
    label: "Schwab L1 est.",
    ...dayFields(sym, rxMs),
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, b.bucket_ms + 999, rxMs));
}

function emitFlow60s(sym: string, slot: OpenFlow, b: Bucket60s, rxMs: number): void {
  if (slot.lastEmitted60sMinuteMs != null && b.minute_ms <= slot.lastEmitted60sMinuteMs) return;
  const has =
    b.call_buy || b.call_sell || b.call_mid || b.put_buy || b.put_sell || b.put_mid || b.n_increments > 0;
  if (!has) return;
  slot.lastEmitted60sMinuteMs = b.minute_ms;
  const payload = {
    type: "flow_60s",
    sym,
    bar_start_ms: b.minute_ms,
    call_buy: b.call_buy,
    call_sell: b.call_sell,
    call_mid: b.call_mid,
    put_buy: b.put_buy,
    put_sell: b.put_sell,
    put_mid: b.put_mid,
    n_l1o_updates: b.n_l1o_updates,
    n_increments: b.n_increments,
    n_contracts: b.n_contracts.size,
    src: "schwab_l1o",
    label: "Schwab L1 est.",
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, b.minute_ms + 59_999, rxMs));
}

export function deskLiveFlowBucketTick(nowMs: number): void {
  for (const [sym, slot] of openBySym) {
    if (slot.b1 && bucketDueToClose(slot.b1.bucket_ms, nowMs, 1000)) {
      emitFlow1s(sym, slot.b1, nowMs);
      slot.b1 = null;
    }
    if (slot.b60 && bucketDueToClose(slot.b60.minute_ms, nowMs, 60_000)) {
      emitFlow60s(sym, slot, slot.b60, nowMs);
      slot.b60 = null;
    }
  }
  if (deskLiveFlowL1oEnabled() && !openBySym.get("SPX")?.b1) {
    const b = bucketMs1s(nowMs);
    if (lastIdleFlowHeartbeatBucketMs !== b) {
      emitFlowHeartbeat(b, nowMs, true);
      lastIdleFlowHeartbeatBucketMs = b;
    }
  }
}

function pxSrcTs(
  item: Record<string, unknown>,
  rxMs: number,
  prev: { last: number | null; bid: number | null; ask: number | null },
  next: { last: number | null; bid: number | null; ask: number | null },
): number {
  const quoteTs = num(item["34"]) ?? rxMs;
  const tradeTs = num(item["35"]) ?? rxMs;
  const lastChg = next.last !== prev.last;
  const quoteChg = next.bid !== prev.bid || next.ask !== prev.ask;
  if (lastChg && quoteChg) return Math.max(quoteTs, tradeTs);
  if (lastChg) return tradeTs;
  return quoteTs;
}

function emitPxFrame(
  last: number | null,
  bid: number | null,
  ask: number | null,
  srcTs: number,
  rxMs: number,
): void {
  lastPx = { last, bid, ask };
  lastEmittedPxSrcTs = Math.max(lastEmittedPxSrcTs, srcTs);
  const payload = { type: "px", sym: "$SPX", last, bid, ask };
  recordFrame(wrapDeskLiveFlowFrame(payload, srcTs, rxMs));
}

function flushPxTrailing(rxMs: number): void {
  if (!pxTrailing || !deskLiveFlowPxEnabled()) return;
  const { last, bid, ask, srcTs } = pxTrailing;
  pxTrailing = null;
  pxTrailingTimer = null;
  if (srcTs < lastEmittedPxSrcTs) return;
  emitPxFrame(last, bid, ask, srcTs, rxMs);
}

export function deskLiveFlowEmitPx(symKey: string, item: Record<string, unknown>, rxMs: number): void {
  if (!deskLiveFlowPxEnabled()) return;
  if (symKey !== "$SPX") return;
  const last = num(item["3"]) ?? lastPx.last;
  const bid = num(item["1"]) ?? lastPx.bid;
  const ask = num(item["2"]) ?? lastPx.ask;
  if (lastPx.last === last && lastPx.bid === bid && lastPx.ask === ask) return;
  const srcTs = pxSrcTs(item, rxMs, lastPx, { last, bid, ask });
  if (rxMs - pxWindowStartMs >= 1000) {
    pxWindowStartMs = rxMs;
    pxEmitsInWindow = 0;
  }
  if (pxEmitsInWindow >= DESK_LIVE_FLOW_PX_MAX_PER_SEC) {
    pxTrailing = { last, bid, ask, srcTs };
    if (pxTrailingTimer) clearTimeout(pxTrailingTimer);
    pxTrailingTimer = setTimeout(() => flushPxTrailing(Date.now()), 250);
    pxTrailingTimer.unref?.();
    return;
  }
  if (pxTrailingTimer) {
    clearTimeout(pxTrailingTimer);
    pxTrailingTimer = null;
  }
  pxTrailing = null;
  pxEmitsInWindow += 1;
  emitPxFrame(last, bid, ask, srcTs, rxMs);
}

export function deskLiveFlowOnStreamerSessionReset(_reason: string): void {
  contractState.clear();
  openBySym.clear();
  lastIdleFlowHeartbeatBucketMs = null;
  lastEmittedPxSrcTs = 0;
  pxTrailing = null;
  if (pxTrailingTimer) clearTimeout(pxTrailingTimer);
  pxTrailingTimer = null;
  void import("./deskLiveFlowTape.js").then((m) => m.deskLiveFlowTapeOnSessionReset());
}

export function deskLiveFlowOnContractsDropped(keys: string[]): void {
  deskLiveFlowSessionDropContracts(contractState, keys);
}

export function deskLiveFlowOnContractsRebaseline(keys: string[]): void {
  deskLiveFlowSessionRebaselineContracts(contractState, keys);
}

export function deskLiveFlowOnConnectionOpened(connectionId: number): void {
  if (deskLiveFlowSessionMarkConnection(connectionId)) {
    deskLiveFlowOnStreamerSessionReset("connection_opened");
  }
}

export function deskLiveFlowOnL1oRows(
  content: Record<string, unknown>[],
  rxMs: number,
): void {
  if (!deskLiveFlowL1oEnabled()) return;
  if (deskLiveFlowSessionMarkSessionDate(new Date(rxMs))) {
    dayBook.clear();
    deskLiveFlowOnStreamerSessionReset("session_date_change");
  }
  for (const item of content) {
    const key = String(item["key"] ?? "").trim();
    const sym = optionFlowSymbol(key);
    if (!sym) continue;
    const side = deskLiveFlowOptionSide(key);
    if (!side) continue;
    const row = parseL1oSchwabRow(key, item, rxMs, side);
    const prev = contractState.get(key);
    const { next, increments } = applyL1oFlowTick(prev, row);
    contractState.set(key, next);
    for (const inc of increments) applyIncrementToBuckets(inc, true, sym);
  }
}

/** Option rows the desk tape filter drops. Classified only for an active equity flow subscription. */
export function deskLiveFlowIngestEquityOptions(
  msg: Record<string, unknown>,
  rxMs: number,
  connectionId?: number,
): void {
  if (!deskLiveFlowL1oEnabled()) return;
  if (connectionId != null && deskLiveFlowSessionMarkConnection(connectionId)) {
    deskLiveFlowOnStreamerSessionReset("connection_frame");
  }
  const data = msg["data"];
  if (!Array.isArray(data)) return;
  const rows: Record<string, unknown>[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { service?: string; content?: unknown[] };
    if (item.service !== "LEVELONE_OPTIONS" || !Array.isArray(item.content)) continue;
    for (const row of item.content) {
      if (!row || typeof row !== "object") continue;
      const key = String((row as { key?: unknown }).key ?? "").trim();
      if (!key || deskLiveFlowIsSpxOptionKey(key)) continue;
      rows.push(row as Record<string, unknown>);
    }
  }
  if (rows.length > 0) deskLiveFlowOnL1oRows(rows, rxMs);
}

export function deskLiveFlowOnInbound(
  msg: Record<string, unknown>,
  rxMs: number,
  connectionId?: number,
): void {
  if (connectionId != null) {
    if (deskLiveFlowSessionMarkConnection(connectionId)) {
      deskLiveFlowOnStreamerSessionReset("connection_frame");
    }
  }
  const data = msg["data"] as Array<{ service?: string; content?: Record<string, unknown>[] }> | undefined;
  if (!data) return;
  for (const item of data) {
    if (item.service === "LEVELONE_EQUITIES" && item.content) {
      for (const row of item.content) {
        const sym = String(row["key"] ?? "");
        deskLiveFlowEmitPx(sym, row, rxMs);
      }
    }
    if (item.service === "LEVELONE_OPTIONS" && item.content) {
      deskLiveFlowOnL1oRows(item.content, rxMs);
    }
  }
}

function uwPayloadsEqual(
  a: NonNullable<ReturnType<typeof deskLiveFlowMapUwNetPremRow>>,
  b: NonNullable<ReturnType<typeof deskLiveFlowMapUwNetPremRow>>,
): boolean {
  return (
    a.net_call === b.net_call &&
    a.net_put === b.net_put &&
    a.call_prem_bought === b.call_prem_bought &&
    a.call_prem_sold === b.call_prem_sold &&
    a.put_prem_bought === b.put_prem_bought &&
    a.put_prem_sold === b.put_prem_sold
  );
}

/** Bars already seen this process, so a new flow-stream client gets the session before the next poll. */
export function deskLiveFlowUwBarSnapshot(sym: string): NonNullable<ReturnType<typeof deskLiveFlowMapUwNetPremRow>>[] {
  const want = sym.trim().toUpperCase().replace(/^\$/, "");
  const out: NonNullable<ReturnType<typeof deskLiveFlowMapUwNetPremRow>>[] = [];
  for (const bar of uwBarByKey.values()) {
    if (bar && bar.sym === want) out.push(bar);
  }
  out.sort((a, b) => a.bar_start_ms - b.bar_start_ms);
  return out;
}

export function deskLiveFlowOnUwNetPremRows(
  rows: unknown[],
  sym: string,
  polledAtMs: number,
): void {
  if (!deskLiveFlowUwBarsEnabled()) return;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const mapped = deskLiveFlowMapUwNetPremRow(raw as Record<string, unknown>, sym, polledAtMs);
    if (!mapped) continue;
    const dedupeKey = `${mapped.sym}|${mapped.bar_start_ms}`;
    const prev = uwBarByKey.get(dedupeKey);
    if (prev && uwPayloadsEqual(prev, mapped)) continue;
    uwBarByKey.set(dedupeKey, mapped);
    while (uwBarByKey.size > UW_BAR_MAP_CAP) {
      const first = uwBarByKey.keys().next().value;
      if (first != null) uwBarByKey.delete(first);
    }
    recordFrame(wrapDeskLiveFlowFrame(mapped, mapped.bar_start_ms, polledAtMs));
  }
}

export function deskLiveFlowFlushOpenBuckets(rxMs: number): void {
  for (const [sym, slot] of openBySym) {
    if (slot.b1) {
      emitFlow1s(sym, slot.b1, rxMs);
      slot.b1 = null;
    }
    if (slot.b60) {
      emitFlow60s(sym, slot, slot.b60, rxMs);
      slot.b60 = null;
    }
  }
}

export function deskLiveFlowReplayL1o(
  rows: Array<{ key: string; fields: Record<string, unknown>; rxMs: number }>,
): DeskLiveFlowFrame[] {
  const before = deskLiveFlowTestFrameCount();
  for (const r of rows) {
    const side = deskLiveFlowOptionSide(r.key);
    if (!side) continue;
    const item = { key: r.key, ...r.fields };
    deskLiveFlowOnL1oRows([item], r.rxMs);
  }
  deskLiveFlowFlushOpenBuckets(rows.at(-1)?.rxMs ?? Date.now());
  return deskLiveFlowTestSliceFrames(before);
}

export function deskLiveFlowResetEngineForTests(): void {
  contractState.clear();
  openBySym.clear();
  dayBook.clear();
  lastPx = { last: null, bid: null, ask: null };
  pxWindowStartMs = 0;
  pxEmitsInWindow = 0;
  pxTrailing = null;
  uwBarByKey.clear();
  lastIdleFlowHeartbeatBucketMs = null;
  lastEmittedPxSrcTs = 0;
  bucketsHooked = false;
}

export function deskLiveFlowContractStateForTests(): Map<string, ContractFlowState> {
  return new Map(contractState);
}