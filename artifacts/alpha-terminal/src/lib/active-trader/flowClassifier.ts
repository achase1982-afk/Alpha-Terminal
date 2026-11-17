import type { OptionTick } from "@/lib/options-stream-store";

export type FlowBadge = "B" | "S" | "=" | null;
export type FlowLane = "call_buy" | "call_sell" | "put_buy" | "put_sell" | "even" | "unknown";

export interface FlowLaneCounts {
  buy: number;
  sell: number;
  even: number;
  unknown: number;
}

export interface TickClassifierState {
  prevBid: number | null;
  prevAsk: number | null;
  prevVolume: number;
  windowBuy: number;
  windowSell: number;
  windowEven: number;
  windowUnknown: number;
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
): "buy" | "sell" | "even" | "unknown" {
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

export function ingestOptionTickForFlow(key: string, tick: OptionTick, windowMs: number): FlowLaneCounts {
  let st = stateByKey.get(key);
  if (!st) {
    st = {
      prevBid: tick.bid,
      prevAsk: tick.ask,
      prevVolume: tick.volume ?? 0,
      windowBuy: 0,
      windowSell: 0,
      windowEven: 0,
      windowUnknown: 0,
    };
    stateByKey.set(key, st);
    return { buy: 0, sell: 0, even: 0, unknown: 0 };
  }

  const vol = tick.volume ?? st.prevVolume;
  const dV = vol - st.prevVolume;
  if (dV > 0 && tick.last != null) {
  const side = classifyQuoteRule(st.prevBid, st.prevAsk, tick.last);
    const qty = tick.lastSize != null && tick.lastSize > 0 ? Math.min(dV, tick.lastSize) : dV;
    if (side === "buy") st.windowBuy += qty;
    else if (side === "sell") st.windowSell += qty;
    else if (side === "even") st.windowEven += qty;
    else st.windowUnknown += qty;
  }

  st.prevBid = tick.bid ?? st.prevBid;
  st.prevAsk = tick.ask ?? st.prevAsk;
  st.prevVolume = vol;

  void windowMs;
  return {
    buy: st.windowBuy,
    sell: st.windowSell,
    even: st.windowEven,
    unknown: st.windowUnknown,
  };
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
    st.windowBuy = 0;
    st.windowSell = 0;
    st.windowEven = 0;
    st.windowUnknown = 0;
  }
}

export function getFlowCountsForKey(key: string): FlowLaneCounts {
  const st = stateByKey.get(key);
  if (!st) return { buy: 0, sell: 0, even: 0, unknown: 0 };
  return { buy: st.windowBuy, sell: st.windowSell, even: st.windowEven, unknown: st.windowUnknown };
}

/** Dev/test harness: pre-seed window counts (does not run in production routes). */
export function seedFlowCountsForKey(key: string, counts: FlowLaneCounts, prevVolume = 0): void {
  stateByKey.set(key, {
    prevBid: 1,
    prevAsk: 1.05,
    prevVolume,
    windowBuy: counts.buy,
    windowSell: counts.sell,
    windowEven: counts.even,
    windowUnknown: counts.unknown,
  });
}