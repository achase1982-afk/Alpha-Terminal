import { isDeskAllowedOptionKey } from "./deskTapeFrameFilter.js";
import {
  applyL1oFlowTick,
  parseL1oSchwabRow,
  type ContractFlowState,
  type FlowIncrement,
} from "./deskLiveFlowClassify.js";
import { deskLiveFlowOptionSide, deskLiveFlowIsSpxOptionKey } from "./deskLiveFlowOcc.js";
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

const contractState = new Map<string, ContractFlowState>();
let open1s: Bucket1s | null = null;
let open60s: Bucket60s | null = null;
const emittedFlow60s = new Set<number>();

let lastPx: { last: number | null; bid: number | null; ask: number | null } = {
  last: null,
  bid: null,
  ask: null,
};
let pxWindowStartMs = 0;
let pxEmitsInWindow = 0;
let pxTrailing: { last: number | null; bid: number | null; ask: number | null; srcTs: number } | null = null;
let pxTrailingTimer: ReturnType<typeof setTimeout> | null = null;

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

function applyIncrementToBuckets(inc: FlowIncrement, hadL1oFrame: boolean): void {
  ensureBucketTimer();
  const bms = bucketMs1s(inc.rxMs);
  if (!open1s || open1s.bucket_ms !== bms) {
    if (open1s) emitFlow1s(open1s, inc.rxMs);
    open1s = freshBucket1s(bms);
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
  if (field) open1s[field] += inc.dollars;
  if (hadL1oFrame) open1s.n_l1o_updates += 1;
  open1s.n_increments += 1;
  open1s.n_contracts.add(inc.key);

  const mms = minuteMs(bms);
  if (!open60s || open60s.minute_ms !== mms) {
    if (open60s) emitFlow60s(open60s, inc.rxMs);
    open60s = freshBucket60s(bms);
  }
  const field60 = map[sideKey];
  if (field60) open60s[field60] += inc.dollars;
  if (hadL1oFrame) open60s.n_l1o_updates += 1;
  open60s.n_increments += 1;
  open60s.n_contracts.add(inc.key);
}

function emitFlow1s(b: Bucket1s, rxMs: number, forceEmpty = false): void {
  const has =
    b.call_buy || b.call_sell || b.call_mid || b.put_buy || b.put_sell || b.put_mid || b.n_increments > 0;
  if (!has && !forceEmpty) {
    emitFlowHeartbeat(b.bucket_ms, rxMs, true);
    return;
  }
  if (!has && forceEmpty) {
    emitFlowHeartbeat(b.bucket_ms, rxMs, true);
    return;
  }
  const payload = {
    type: "flow_1s",
    sym: "SPX",
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
  };
  recordFrame(wrapDeskLiveFlowFrame(payload, b.bucket_ms + 999, rxMs));
}

function emitFlow60s(b: Bucket60s, rxMs: number): void {
  if (emittedFlow60s.has(b.minute_ms)) return;
  const has =
    b.call_buy || b.call_sell || b.call_mid || b.put_buy || b.put_sell || b.put_mid || b.n_increments > 0;
  emittedFlow60s.add(b.minute_ms);
  if (!has) return;
  const payload = {
    type: "flow_60s",
    sym: "SPX",
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
  if (open1s && bucketDueToClose(open1s.bucket_ms, nowMs, 1000)) {
    emitFlow1s(open1s, nowMs, true);
    open1s = null;
  }
  if (open60s && bucketDueToClose(open60s.minute_ms, nowMs, 60_000)) {
    emitFlow60s(open60s, nowMs);
    open60s = null;
  }
}

function flushPxTrailing(rxMs: number): void {
  if (!pxTrailing || !deskLiveFlowPxEnabled()) return;
  const { last, bid, ask, srcTs } = pxTrailing;
  pxTrailing = null;
  if (pxTrailingTimer) {
    clearTimeout(pxTrailingTimer);
    pxTrailingTimer = null;
  }
  const payload = { type: "px", sym: "$SPX", last, bid, ask };
  recordFrame(wrapDeskLiveFlowFrame(payload, srcTs, rxMs));
}

export function deskLiveFlowEmitPx(symKey: string, item: Record<string, unknown>, rxMs: number): void {
  if (!deskLiveFlowPxEnabled()) return;
  if (symKey !== "$SPX") return;
  const last = num(item["3"]) ?? lastPx.last;
  const bid = num(item["1"]) ?? lastPx.bid;
  const ask = num(item["2"]) ?? lastPx.ask;
  const srcTs = num(item["34"]) ?? num(item["35"]) ?? rxMs;
  if (lastPx.last === last && lastPx.bid === bid && lastPx.ask === ask) return;
  lastPx = { last, bid, ask };
  if (rxMs - pxWindowStartMs >= 1000) {
    pxWindowStartMs = rxMs;
    pxEmitsInWindow = 0;
  }
  if (pxEmitsInWindow >= DESK_LIVE_FLOW_PX_MAX_PER_SEC) {
    pxTrailing = { last, bid, ask, srcTs };
    if (!pxTrailingTimer) {
      pxTrailingTimer = setTimeout(() => flushPxTrailing(Date.now()), 250);
      pxTrailingTimer.unref?.();
    }
    return;
  }
  pxEmitsInWindow += 1;
  const payload = { type: "px", sym: "$SPX", last, bid, ask };
  recordFrame(wrapDeskLiveFlowFrame(payload, srcTs, rxMs));
}

export function deskLiveFlowOnStreamerSessionReset(_reason: string): void {
  contractState.clear();
  open1s = null;
  open60s = null;
  emittedFlow60s.clear();
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
    deskLiveFlowOnStreamerSessionReset("session_date_change");
  }
  for (const item of content) {
    const key = String(item["key"] ?? "").trim();
    if (!key || !isDeskAllowedOptionKey(key) || !deskLiveFlowIsSpxOptionKey(key)) continue;
    const side = deskLiveFlowOptionSide(key);
    if (!side) continue;
    const row = parseL1oSchwabRow(key, item, rxMs, side);
    const prev = contractState.get(key);
    const { next, increments } = applyL1oFlowTick(prev, row);
    contractState.set(key, next);
    for (const inc of increments) applyIncrementToBuckets(inc, true);
  }
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
    recordFrame(wrapDeskLiveFlowFrame(mapped, mapped.bar_start_ms, polledAtMs));
    if (open60s && open60s.minute_ms === mapped.bar_start_ms) {
      emitFlow60s(open60s, polledAtMs);
      open60s = null;
    }
  }
}

export function deskLiveFlowFlushOpenBuckets(rxMs: number): void {
  if (open1s) {
    emitFlow1s(open1s, rxMs);
    open1s = null;
  }
  if (open60s) {
    emitFlow60s(open60s, rxMs);
    open60s = null;
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
  open1s = null;
  open60s = null;
  lastPx = { last: null, bid: null, ask: null };
  pxWindowStartMs = 0;
  pxEmitsInWindow = 0;
  pxTrailing = null;
  uwBarByKey.clear();
  emittedFlow60s.clear();
  bucketsHooked = false;
}

export function deskLiveFlowContractStateForTests(): Map<string, ContractFlowState> {
  return new Map(contractState);
}