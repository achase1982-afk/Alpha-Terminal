import { create } from "zustand";
import { sanitizeOptionGreek } from "@workspace/order-ticket-math";

export interface OptionTick {
  key: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  bidSize: number | null;
  askSize: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  mark: number | null;
  change: number | null;
  lastSize: number | null;
  underlyingPrice: number | null;
  quoteTime: number | null;
  tradeTime: number | null;
  ts: number;
}

const TICK_FIELDS: (keyof OptionTick)[] = [
  "bid", "ask", "last", "bidSize", "askSize",
  "volume", "openInterest", "iv", "delta", "gamma",
  "theta", "vega", "mark", "change", "lastSize", "underlyingPrice",
  "quoteTime", "tradeTime",
];

function mergeOptionTicks(existing: OptionTick, incoming: OptionTick): OptionTick {
  const next: OptionTick = { ...existing, key: incoming.key, ts: incoming.ts };
  for (const f of TICK_FIELDS) {
    const v = incoming[f] as number | null;
    if (v == null || Number.isNaN(v)) continue;
    switch (f) {
      case "bid":
        if (v > 0) next.bid = v;
        break;
      case "ask":
        if (v > 0) next.ask = v;
        break;
      case "last": next.last = v; break;
      case "bidSize": next.bidSize = v; break;
      case "askSize": next.askSize = v; break;
      case "volume": next.volume = v; break;
      case "openInterest": next.openInterest = v; break;
      case "iv": {
        const iv = sanitizeOptionGreek("iv", v);
        if (iv != null) next.iv = iv;
        break;
      }
      case "delta": {
        const d = sanitizeOptionGreek("delta", v);
        if (d != null) next.delta = d;
        break;
      }
      case "gamma": {
        const g = sanitizeOptionGreek("gamma", v);
        if (g != null) next.gamma = g;
        break;
      }
      case "theta": {
        const t = sanitizeOptionGreek("theta", v);
        if (t != null) next.theta = t;
        break;
      }
      case "vega": {
        const ve = sanitizeOptionGreek("vega", v);
        if (ve != null) next.vega = ve;
        break;
      }
      case "mark": next.mark = v; break;
      case "change": next.change = v; break;
      case "lastSize": next.lastSize = v; break;
      case "underlyingPrice": next.underlyingPrice = v; break;
      case "quoteTime": next.quoteTime = v; break;
      case "tradeTime": next.tradeTime = v; break;
    }
  }
  if (incoming.iv != null && incoming.iv <= -999) next.iv = existing.iv;
  return next;
}

interface OptionsStreamState {
  ticks: Record<string, OptionTick>;
  mergeTick: (tick: OptionTick) => void;
  clearTicks: () => void;
}

export const useOptionsStreamStore = create<OptionsStreamState>()((set) => ({
  ticks: {},
  mergeTick: (tick) =>
    set((state) => {
      const cleaned = { ...tick };
      if (cleaned.iv != null && cleaned.iv <= -999) cleaned.iv = null;
      const existing = state.ticks[tick.key];
      const merged = existing ? mergeOptionTicks(existing, cleaned) : cleaned;
      if (existing) {
        let changed = false;
        for (const f of TICK_FIELDS) {
          if (merged[f] !== existing[f]) { changed = true; break; }
        }
        if (merged.ts !== existing.ts) changed = true;
        if (!changed) return state;
      }
      return { ticks: { ...state.ticks, [tick.key]: merged } };
    }),
  clearTicks: () => set({ ticks: {} }),
}));

export function useOptionTick(contractKey: string | undefined): OptionTick | undefined {
  return useOptionsStreamStore((s) => (contractKey ? s.ticks[contractKey] : undefined));
}
