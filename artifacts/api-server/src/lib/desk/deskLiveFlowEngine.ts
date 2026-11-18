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

type Bucket1s = {
  bucket_ms: number;
  call_buy: number;
  call_sell: number;
  call_mid: number;
  put_buy: number;
  put_sell: number;
  put_mid: number;
  n_frames: number;
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
  n_frames: number;
  n_contracts: Set<string>;
};

const contractState = new Map<string, ContractFlowState>();
let open1s: Bucket1s | null = null;
let open60s: Bucket60s | null = null;

let lastPx: { last: number | null; bid: number | null; ask: number | null } | null = null;
let pxWindowStartMs = 0;
let pxEmitsInWindow = 0;

const seenUwBars = new Set<number>();
const emittedFrames: DeskLiveFlowFrame[] = [];

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function minuteMs(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

function bucketMs1s(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
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
    n_frames: 0,
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
    n_frames: 0,
    n_contracts: new Set(),
  };
}

function applyIncrementToBuckets(inc: FlowIncrement): void {
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
  open1s.n_frames += 1;
  open1s.n_contracts.add(inc.key);

  const mms = minuteMs(bms);
  if (!open60s || open60s.minute_ms !== mms) {
    if (open60s) emitFlow60s(open60s, inc.rxMs);
    open60s = freshBucket60s(bms);
  }
  const field60 = map[sideKey];
  if (field60) open60s[field60] += inc.dollars;
  open60s.n_frames += 1;
  open60s.n_contracts.add(inc.key);
}

function emitFlow1s(b: Bucket1s, rxMs: number): void {
  const has =
    b.call_buy || b.call_sell || b.call_mid || b.put_buy || b.put_sell || b.put_mid || b.n_frames > 0;
  if (!has) return;
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
    n_frames: b.n_frames,
    n_contracts: b.n_contracts.size,
    src: "schwab_l1o",
    label: "Schwab L1 est.",
  };
  const frame = wrapDeskLiveFlowFrame(payload, b.bucket_ms + 999, rxMs);
  emittedFrames.push(frame);
  deskLiveFlowBroadcastFrame(frame);
}

function emitFlow60s(b: Bucket60s, rxMs: number): void {
  const has =
    b.call_buy || b.call_sell || b.call_mid || b.put_buy || b.put_sell || b.put_mid || b.n_frames > 0;
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
    n_frames: b.n_frames,
    n_contracts: b.n_contracts.size,
    src: "schwab_l1o",
    label: "Schwab L1 est.",
  };
  const frame = wrapDeskLiveFlowFrame(payload, b.minute_ms + 59_999, rxMs);
  emittedFrames.push(frame);
  deskLiveFlowBroadcastFrame(frame);
}

export function deskLiveFlowEmitPx(symKey: string, item: Record<string, unknown>, rxMs: number): void {
  if (!deskLiveFlowPxEnabled()) return;
  if (symKey !== "$SPX") return;
  const last = num(item["3"]);
  const bid = num(item["1"]);
  const ask = num(item["2"]);
  const srcTs = num(item["34"]) ?? num(item["35"]) ?? rxMs;
  if (lastPx && lastPx.last === last && lastPx.bid === bid && lastPx.ask === ask) return;
  const windowMs = 1000 / DESK_LIVE_FLOW_PX_MAX_PER_SEC;
  if (rxMs - pxWindowStartMs >= 1000) {
    pxWindowStartMs = rxMs;
    pxEmitsInWindow = 0;
  }
  if (pxEmitsInWindow >= DESK_LIVE_FLOW_PX_MAX_PER_SEC) return;
  pxEmitsInWindow += 1;
  lastPx = { last, bid, ask };
  const payload = {
    type: "px",
    sym: "$SPX",
    last,
    bid,
    ask,
  };
  const frame = wrapDeskLiveFlowFrame(payload, srcTs, rxMs);
  emittedFrames.push(frame);
  deskLiveFlowBroadcastFrame(frame);
}

export function deskLiveFlowOnL1oRows(
  content: Record<string, unknown>[],
  rxMs: number,
): void {
  if (!deskLiveFlowL1oEnabled()) return;
  for (const item of content) {
    const key = String(item["key"] ?? "").trim();
    if (!key || !isDeskAllowedOptionKey(key) || !deskLiveFlowIsSpxOptionKey(key)) continue;
    const side = deskLiveFlowOptionSide(key);
    if (!side) continue;
    const row = parseL1oSchwabRow(key, item, rxMs, side);
    const prev = contractState.get(key);
    const { next, increments } = applyL1oFlowTick(prev, row);
    contractState.set(key, next);
    for (const inc of increments) applyIncrementToBuckets(inc);
  }
}

export function deskLiveFlowOnInbound(msg: Record<string, unknown>, rxMs: number): void {
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
    if (seenUwBars.has(mapped.bar_start_ms)) continue;
    seenUwBars.add(mapped.bar_start_ms);
    const frame = wrapDeskLiveFlowFrame(mapped, mapped.bar_start_ms, polledAtMs);
    emittedFrames.push(frame);
    deskLiveFlowBroadcastFrame(frame);
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

/** Vitest: replay L1O rows in order without streamer. */
export function deskLiveFlowReplayL1o(
  rows: Array<{ key: string; fields: Record<string, unknown>; rxMs: number }>,
): DeskLiveFlowFrame[] {
  const before = emittedFrames.length;
  for (const r of rows) {
    const side = deskLiveFlowOptionSide(r.key);
    if (!side) continue;
    const item = { key: r.key, ...r.fields };
    deskLiveFlowOnL1oRows([item], r.rxMs);
  }
  deskLiveFlowFlushOpenBuckets(rows.at(-1)?.rxMs ?? Date.now());
  return emittedFrames.slice(before);
}

export function deskLiveFlowResetEngineForTests(): void {
  contractState.clear();
  open1s = null;
  open60s = null;
  lastPx = null;
  pxWindowStartMs = 0;
  pxEmitsInWindow = 0;
  seenUwBars.clear();
  emittedFrames.length = 0;
}

export function deskLiveFlowEmittedFramesForTests(): DeskLiveFlowFrame[] {
  return [...emittedFrames];
}