import type { OptionTick } from "@/lib/options-stream-store";

export type FlowBadge = "B" | "S" | "=" | null;
export type FlowLane = "call_buy" | "call_sell" | "put_buy" | "put_sell" | "even" | "unknown";

export interface FlowLaneCounts {
  buy: number;
  sell: number;
  even: number;
  unknown: number;
}

type FlowSide = "buy" | "sell" | "even" | "unknown";

interface FlowWindowEvent {
  ms: number;
  qty: number;
  side: FlowSide;
}

interface TickClassifierState {
  prevBid: number | null;
  prevAsk: number | null;
  prevVolume: number;
  events: FlowWindowEvent[];
}

const stateByKey = new Map<string, TickClassifierState>();

function mid(bid: number, ask: number): number {
  return (bid + ask) / 2;
}

/** Quote-rule inference from L1 (labeled in UI as inference, not exchange aggressor). */
export function classifyQuoteRule(
  bid: number | null,
  ask: number | null,
  tradePx: number | null,
): FlowSide {
  if (bid == null || ask == null || tradePx == null || bid <= 0 || ask <= 0 || ask < bid) return "unknown";
  const m = mid(bid, ask);
  const w = ask - bid;
  if (tradePx >= ask) return "buy";
  if (tradePx <= bid) return "sell";
  if (w > Math.max(0.02, m * 0.1)) return "unknown";
  const eps = Math.max(0.005, w * 0.05);
  if (tradePx > m + eps) return "buy";
  if (tradePx < m - eps) return "sell";
  return "even";
}

function pruneEvents(st: TickClassifierState, windowMs: number, nowMs: number): void {
  const cutoff = nowMs - windowMs;
  if (st.events.length === 0) return;
  let i = 0;
  while (i < st.events.length && st.events[i]!.ms < cutoff) i += 1;
  if (i > 0) st.events = st.events.slice(i);
}

function countsFromEvents(events: FlowWindowEvent[]): FlowLaneCounts {
  const out: FlowLaneCounts = { buy: 0, sell: 0, even: 0, unknown: 0 };
  for (const e of events) {
    out[e.side] += e.qty;
  }
  return out;
}

export function ingestOptionTickForFlow(
  key: string,
  tick: OptionTick,
  windowMs: number,
  nowMs: number = Date.now(),
): FlowLaneCounts {
  let st = stateByKey.get(key);
  if (!st) {
    st = {
      prevBid: tick.bid,
      prevAsk: tick.ask,
      prevVolume: tick.volume ?? 0,
      events: [],
    };
    stateByKey.set(key, st);
    return { buy: 0, sell: 0, even: 0, unknown: 0 };
  }

  pruneEvents(st, windowMs, nowMs);

  const vol = tick.volume ?? st.prevVolume;
  const dV = vol - st.prevVolume;
  if (dV > 0 && tick.last != null) {
    const side = classifyQuoteRule(st.prevBid, st.prevAsk, tick.last);
    const qty = tick.lastSize != null && tick.lastSize > 0 ? Math.min(dV, tick.lastSize) : dV;
    st.events.push({ ms: nowMs, qty, side });
    pruneEvents(st, windowMs, nowMs);
  }

  st.prevBid = tick.bid ?? st.prevBid;
  st.prevAsk = tick.ask ?? st.prevAsk;
  st.prevVolume = vol;

  return countsFromEvents(st.events);
}

/** Total estimated contracts traded in the rolling window (all sides). */
export function getFlowActivityForKey(key: string, windowMs: number, nowMs: number = Date.now()): number {
  const st = stateByKey.get(key);
  if (!st) return 0;
  pruneEvents(st, windowMs, nowMs);
  let total = 0;
  for (const e of st.events) total += e.qty;
  return total;
}

export function flowBadgeFromCounts(c: FlowLaneCounts): FlowBadge {
  const classified = c.buy + c.sell + c.even;
  if (classified < 3) return null;
  if (c.buy / classified >= 0.6) return "B";
  if (c.sell / classified >= 0.6) return "S";
  if (c.even / classified >= 0.6) return "=";
  return "=";
}

export function resetFlowClassifierWindow(): void {
  for (const st of stateByKey.values()) {
    st.events = [];
  }
}

export function getFlowCountsForKey(key: string, windowMs?: number, nowMs: number = Date.now()): FlowLaneCounts {
  const st = stateByKey.get(key);
  if (!st) return { buy: 0, sell: 0, even: 0, unknown: 0 };
  if (windowMs != null) pruneEvents(st, windowMs, nowMs);
  return countsFromEvents(st.events);
}

/** Dev/test harness: pre-seed window counts (does not run in production routes). */
export function seedFlowCountsForKey(key: string, counts: FlowLaneCounts, prevVolume = 0, nowMs = Date.now()): void {
  const events: FlowWindowEvent[] = [];
  if (counts.buy > 0) events.push({ ms: nowMs, qty: counts.buy, side: "buy" });
  if (counts.sell > 0) events.push({ ms: nowMs, qty: counts.sell, side: "sell" });
  if (counts.even > 0) events.push({ ms: nowMs, qty: counts.even, side: "even" });
  if (counts.unknown > 0) events.push({ ms: nowMs, qty: counts.unknown, side: "unknown" });
  stateByKey.set(key, {
    prevBid: 1,
    prevAsk: 1.05,
    prevVolume,
    events,
  });
}