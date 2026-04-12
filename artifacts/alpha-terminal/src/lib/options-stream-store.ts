import { create } from "zustand";

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
  ts: number;
}

const TICK_FIELDS: (keyof OptionTick)[] = [
  "bid", "ask", "last", "bidSize", "askSize",
  "volume", "openInterest", "iv", "delta", "gamma",
  "theta", "vega", "mark", "change",
];

interface OptionsStreamState {
  ticks: Record<string, OptionTick>;
  mergeTick: (tick: OptionTick) => void;
  clearTicks: () => void;
}

export const useOptionsStreamStore = create<OptionsStreamState>()((set) => ({
  ticks: {},
  mergeTick: (tick) =>
    set((state) => {
      if (tick.iv != null && tick.iv <= -999) tick.iv = null;
      const existing = state.ticks[tick.key];
      if (existing) {
        let changed = false;
        for (const f of TICK_FIELDS) {
          if (tick[f] !== existing[f]) { changed = true; break; }
        }
        if (!changed) return state;
      }
      return { ticks: { ...state.ticks, [tick.key]: tick } };
    }),
  clearTicks: () => set({ ticks: {} }),
}));

export function useOptionTick(contractKey: string | undefined): OptionTick | undefined {
  return useOptionsStreamStore((s) => (contractKey ? s.ticks[contractKey] : undefined));
}
