import type { DeskFlowFrame } from "./deskFlowFrameTypes";

/** Recorded NVDA tape + optional SPX flow for dev replay captures. */
export const DESK_FLOW_REPLAY_NVDA: DeskFlowFrame[] = [
  {
    type: "tape_1s",
    sym: "NVDA",
    bucket_ms: 1_000,
    buy_$: 240_000,
    sell_$: 80_000,
    n_prints: 3,
    rx_ts_ms: 1_050,
    src_ts_ms: 1_049,
  },
  {
    type: "tape_1s",
    sym: "NVDA",
    bucket_ms: 2_000,
    buy_$: 120_000,
    sell_$: 40_000,
    n_prints: 2,
    rx_ts_ms: 2_100,
  },
  {
    type: "tape_60s",
    sym: "NVDA",
    bar_start_ms: 0,
    buy_$: 360_000,
    sell_$: 120_000,
    n_prints: 5,
    rx_ts_ms: 60_000,
  },
];

export const DESK_FLOW_REPLAY_SPX: DeskFlowFrame[] = [
  {
    type: "flow_1s",
    sym: "SPX",
    bucket_ms: 1_000,
    call_buy: 1.2e6,
    call_sell: 0.35e6,
    put_buy: 0.4e6,
    put_sell: 2.1e6,
    rx_ts_ms: 1_100,
  },
  {
    type: "flow_60s",
    sym: "SPX",
    bar_start_ms: 0,
    call_buy: 5.9e6,
    call_sell: 1.8e6,
    put_buy: 2.2e6,
    put_sell: 18.1e6,
    rx_ts_ms: 60_000,
  },
];

export const DESK_FLOW_REPLAY_ES: DeskFlowFrame[] = [
  {
    type: "tape_1s",
    sym: "/ES",
    bucket_ms: 1_000,
    buy_$: 4.25e6,
    sell_$: 1.6e6,
    n_prints: 12,
    futures_mult: 50,
    rx_ts_ms: 1_200,
  },
  {
    type: "tape_60s",
    sym: "/ES",
    bar_start_ms: 0,
    buy_$: 18e6,
    sell_$: 9.5e6,
    n_prints: 40,
    futures_mult: 50,
    rx_ts_ms: 60_000,
  },
];

export function deskFlowReplayForSymbol(symbol: string): DeskFlowFrame[] {
  const u = symbol.trim().toUpperCase();
  if (u === "SPX" || u === "$SPX") return DESK_FLOW_REPLAY_SPX;
  if (u === "NVDA") return DESK_FLOW_REPLAY_NVDA;
  if (u.startsWith("/ES")) return DESK_FLOW_REPLAY_ES;
  return [];
}