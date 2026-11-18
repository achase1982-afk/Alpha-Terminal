import type { DeskFlowAggregate, DeskIndexFlowTotals } from "./deskFlowAggregator";
import { fmtGlanceFlowAmount } from "./deskFlowMoneyFormat";

export const STALE_FLOW_RX_MS = 8_000;
const SCALE_FLOOR = 50_000;

export type FlowWindow = "1m" | "5m" | "hr";

export type GrossFlowSide = {
  buyUsd: number;
  sellUsd: number;
  buyLabel: string;
  sellLabel: string;
};

export type DeskGrossFlowGlance = {
  unsupported: boolean;
  closed: boolean;
  noPrints: boolean;
  stale: boolean;
  window: FlowWindow;
  calls: GrossFlowSide | null;
  puts: GrossFlowSide | null;
  sharedScale: number;
  netCalls: number;
  netPuts: number;
};

function windowTotals(index: DeskIndexFlowTotals, window: FlowWindow) {
  if (window === "1m") {
    return {
      callBuy: index.callBuy1m,
      callSell: index.callSell1m,
      putBuy: index.putBuy1m,
      putSell: index.putSell1m,
    };
  }
  if (window === "5m") {
    return {
      callBuy: index.callBuy5m,
      callSell: index.callSell5m,
      putBuy: index.putBuy5m,
      putSell: index.putSell5m,
    };
  }
  return {
    callBuy: index.callBuyHr,
    callSell: index.callSellHr,
    putBuy: index.putBuyHr,
    putSell: index.putSellHr,
  };
}

function sideView(buy: number, sell: number): GrossFlowSide {
  return {
    buyUsd: buy,
    sellUsd: sell,
    buyLabel: `Bought $${fmtGlanceFlowAmount(buy)}`,
    sellLabel: `Sold $${fmtGlanceFlowAmount(sell)}`,
  };
}

export function buildDeskGrossFlowGlance(
  agg: DeskFlowAggregate,
  window: FlowWindow,
  opts?: { sessionClosed?: boolean; nowMs?: number },
): DeskGrossFlowGlance {
  const nowMs = opts?.nowMs ?? Date.now();
  const base = {
    window,
    calls: null as GrossFlowSide | null,
    puts: null as GrossFlowSide | null,
    sharedScale: SCALE_FLOOR,
    netCalls: 0,
    netPuts: 0,
    unsupported: false,
    closed: !!opts?.sessionClosed,
    noPrints: false,
    stale: false,
  };

  if (agg.connection === "unsupported") {
    return { ...base, unsupported: true };
  }
  if (opts?.sessionClosed || agg.connection === "offline") {
    return { ...base, closed: true };
  }
  if (agg.connection === "idle" || agg.connection === "no_prints") {
    return { ...base, noPrints: true };
  }

  const stale =
    agg.connection === "live" &&
    agg.lastRxMs != null &&
    nowMs - agg.lastRxMs > STALE_FLOW_RX_MS;
  if (stale) {
    return { ...base, stale: true };
  }

  if (agg.mode !== "index" || !agg.index) {
    return { ...base, unsupported: true };
  }

  const t = windowTotals(agg.index, window);
  const calls = sideView(t.callBuy, t.callSell);
  const puts = sideView(t.putBuy, t.putSell);
  const sharedScale = Math.max(
    SCALE_FLOOR,
    t.callBuy,
    t.callSell,
    t.putBuy,
    t.putSell,
  );

  return {
    ...base,
    calls,
    puts,
    sharedScale,
    netCalls: t.callBuy - t.callSell,
    netPuts: t.putBuy - t.putSell,
    stale: false,
    noPrints: false,
  };
}

export function grossBarFill(amount: number, sharedScale: number): number {
  if (sharedScale <= 0) return 0;
  return Math.min(0.5, amount / sharedScale);
}