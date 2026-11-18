import type { DeskFlowAggregate, DeskFlowAggregatorInternal, DeskFlowConnection } from "./deskFlowAggregator";
import { sumFlow1sWindow, sumTape1sWindow } from "./deskFlowAggregator";
import { fmtGlanceMoneyUsd } from "./deskFlowMoneyFormat";

export const DEFAULT_NET_PREMIUM_WINDOW_MS = 30_000;
export const NET_PREMIUM_WINDOW_CHOICES_MS = [15_000, 30_000, 60_000] as const;
export type NetPremiumWindowMs = (typeof NET_PREMIUM_WINDOW_CHOICES_MS)[number];

export const STALE_FLOW_RX_MS = 8_000;
const NEUTRAL_FRAC = 0.07;
const HYSTERESIS_MS = 1_200;
const SCALE_DECAY = 0.94;

export type NetPremiumDirection = "buy" | "sell" | "mixed" | "quiet";

export type FlowTrackView = {
  side: "calls" | "puts" | "tape_lift" | "tape_hit";
  title: string;
  netUsd: number;
  buyUsd: number;
  sellUsd: number;
  direction: NetPremiumDirection;
  directionLabel: string;
  amountLabel: string;
  barFill: number;
};

export type DeskNetPremiumGlance = {
  streamKind: "spx_options" | "underlying_tape" | "none";
  streamNote: string | null;
  calls: FlowTrackView | null;
  puts: FlowTrackView | null;
  connection: DeskFlowConnection;
  stale: boolean;
  noPrints: boolean;
  unsupported: boolean;
  closed: boolean;
  windowMs: number;
  windowLabel: string;
  grossCallsBuy: number;
  grossCallsSell: number;
  grossPutsBuy: number;
  grossPutsSell: number;
  grossTapeBuy: number;
  grossTapeSell: number;
};

export type NetPremiumHysteresis = {
  calls: NetPremiumDirection;
  puts: NetPremiumDirection;
  callsSinceMs: number;
  putsSinceMs: number;
};

export const EMPTY_HYSTERESIS: NetPremiumHysteresis = {
  calls: "quiet",
  puts: "quiet",
  callsSinceMs: 0,
  putsSinceMs: 0,
};

function windowLabel(ms: number): string {
  if (ms === 15_000) return "15s";
  if (ms === 60_000) return "60s";
  return "30s";
}

function rawDirection(net: number, gross: number, scaleMax: number): NetPremiumDirection {
  if (gross <= 0) return "quiet";
  const band = Math.max(scaleMax * NEUTRAL_FRAC, 25_000);
  if (Math.abs(net) < band) return gross > band * 2 ? "mixed" : "quiet";
  return net > 0 ? "buy" : "sell";
}

function directionLabel(d: NetPremiumDirection): string {
  if (d === "buy") return "Buy";
  if (d === "sell") return "Sell";
  if (d === "mixed") return "Mixed";
  return "Quiet";
}

function applyHysteresis(
  raw: NetPremiumDirection,
  prev: NetPremiumDirection,
  prevSinceMs: number,
  nowMs: number,
): { direction: NetPremiumDirection; sinceMs: number } {
  if (raw === prev) return { direction: prev, sinceMs: prevSinceMs };
  if (nowMs - prevSinceMs < HYSTERESIS_MS && prev !== "quiet" && prev !== "mixed") {
    return { direction: prev, sinceMs: prevSinceMs };
  }
  return { direction: raw, sinceMs: nowMs };
}

function buildTrack(
  side: FlowTrackView["side"],
  title: string,
  buy: number,
  sell: number,
  scaleMax: number,
  hysteresis: NetPremiumHysteresis,
  nowMs: number,
): { track: FlowTrackView; hysteresis: NetPremiumHysteresis } {
  const net = buy - sell;
  const gross = buy + sell;
  const raw = rawDirection(net, gross, scaleMax);
  const prevKey = side === "calls" || side === "tape_lift" ? "calls" : "puts";
  const prevDir = hysteresis[prevKey];
  const prevSince = hysteresis[`${prevKey}SinceMs` as "callsSinceMs"];
  const resolved = applyHysteresis(raw, prevDir, prevSince, nowMs);
  const fill = scaleMax > 0 ? Math.min(1, Math.abs(net) / scaleMax) : 0;
  const track: FlowTrackView = {
    side,
    title,
    netUsd: net,
    buyUsd: buy,
    sellUsd: sell,
    direction: resolved.direction,
    directionLabel: directionLabel(resolved.direction),
    amountLabel: fmtGlanceMoneyUsd(net),
    barFill: fill,
  };
  const nextH = { ...hysteresis, [prevKey]: resolved.direction, [`${prevKey}SinceMs`]: resolved.sinceMs };
  return { track, hysteresis: nextH as NetPremiumHysteresis };
}

export type BuildDeskNetPremiumResult = {
  glance: DeskNetPremiumGlance;
  scaleMax: number;
  hysteresis: NetPremiumHysteresis;
};

export function buildDeskNetPremiumGlance(
  internal: DeskFlowAggregatorInternal,
  agg: DeskFlowAggregate,
  windowMs: number,
  scaleMaxIn: number,
  hysteresisIn: NetPremiumHysteresis,
  nowMs: number = Date.now(),
  opts?: { sessionClosed?: boolean },
): BuildDeskNetPremiumResult {
  let hysteresis = hysteresisIn;
  const windowLabelStr = windowLabel(windowMs);
  const lastRx = agg.lastRxMs;
  const stale =
    !opts?.sessionClosed &&
    agg.connection === "live" &&
    lastRx != null &&
    nowMs - lastRx > STALE_FLOW_RX_MS;

  if (agg.connection === "unsupported") {
    return {
      glance: {
        streamKind: "none",
        streamNote: null,
        calls: null,
        puts: null,
        connection: agg.connection,
        stale: false,
        noPrints: false,
        unsupported: true,
        closed: !!opts?.sessionClosed,
        windowMs,
        windowLabel: windowLabelStr,
        grossCallsBuy: 0,
        grossCallsSell: 0,
        grossPutsBuy: 0,
        grossPutsSell: 0,
        grossTapeBuy: 0,
        grossTapeSell: 0,
      },
      scaleMax: scaleMaxIn,
      hysteresis,
    };
  }

  if (opts?.sessionClosed) {
    return {
      glance: {
        streamKind: agg.mode === "index" ? "spx_options" : "underlying_tape",
        streamNote: agg.mode === "index" ? null : "Underlying tape · not SPX option flow",
        calls: null,
        puts: null,
        connection: "offline",
        stale: false,
        noPrints: false,
        unsupported: false,
        closed: true,
        windowMs,
        windowLabel: windowLabelStr,
        grossCallsBuy: 0,
        grossCallsSell: 0,
        grossPutsBuy: 0,
        grossPutsSell: 0,
        grossTapeBuy: 0,
        grossTapeSell: 0,
      },
      scaleMax: scaleMaxIn,
      hysteresis,
    };
  }

  if (agg.connection === "offline" || agg.connection === "idle" || agg.connection === "no_prints") {
    return {
      glance: {
        streamKind: agg.mode === "index" ? "spx_options" : "underlying_tape",
        streamNote: agg.mode === "index" ? null : "Underlying tape · not SPX option flow",
        calls: null,
        puts: null,
        connection: agg.connection,
        stale: false,
        noPrints: true,
        unsupported: false,
        closed: false,
        windowMs,
        windowLabel: windowLabelStr,
        grossCallsBuy: 0,
        grossCallsSell: 0,
        grossPutsBuy: 0,
        grossPutsSell: 0,
        grossTapeBuy: 0,
        grossTapeSell: 0,
      },
      scaleMax: scaleMaxIn,
      hysteresis,
    };
  }

  let scaleMax = scaleMaxIn;
  let calls: FlowTrackView | null = null;
  let puts: FlowTrackView | null = null;
  let grossCallsBuy = 0;
  let grossCallsSell = 0;
  let grossPutsBuy = 0;
  let grossPutsSell = 0;
  let grossTapeBuy = 0;
  let grossTapeSell = 0;

  if (agg.mode === "index") {
    const w = sumFlow1sWindow(internal.flow1s, nowMs, windowMs);
    grossCallsBuy = w.call_buy ?? 0;
    grossCallsSell = w.call_sell ?? 0;
    grossPutsBuy = w.put_buy ?? 0;
    grossPutsSell = w.put_sell ?? 0;
    const mag = Math.max(
      Math.abs(grossCallsBuy - grossCallsSell),
      Math.abs(grossPutsBuy - grossPutsSell),
      50_000,
    );
    scaleMax = Math.max(scaleMax * SCALE_DECAY, mag);
    const c = buildTrack("calls", "Calls", grossCallsBuy, grossCallsSell, scaleMax, hysteresis, nowMs);
    hysteresis = c.hysteresis;
    const p = buildTrack("puts", "Puts", grossPutsBuy, grossPutsSell, scaleMax, hysteresis, nowMs);
    hysteresis = p.hysteresis;
    calls = c.track;
    puts = p.track;
  } else if (agg.mode === "stock" || agg.mode === "futures") {
    const t = sumTape1sWindow(internal.tape1s, nowMs, windowMs);
    grossTapeBuy = t.buy;
    grossTapeSell = t.sell;
    const mag = Math.max(Math.abs(t.buy - t.sell), 25_000);
    scaleMax = Math.max(scaleMax * SCALE_DECAY, mag);
    const lift = buildTrack("tape_lift", "Lift", t.buy, t.sell, scaleMax, hysteresis, nowMs);
    hysteresis = lift.hysteresis;
    const hit = buildTrack("tape_hit", "Hit", t.sell, t.buy, scaleMax, hysteresis, nowMs);
    hysteresis = hit.hysteresis;
    calls = lift.track;
    puts = hit.track;
  }

  return {
    glance: {
      streamKind: agg.mode === "index" ? "spx_options" : "underlying_tape",
      streamNote: agg.mode === "index" ? null : "Underlying tape · not SPX option flow",
      calls,
      puts,
      connection: stale ? "offline" : agg.connection,
      stale,
      noPrints: false,
      unsupported: false,
      closed: false,
      windowMs,
      windowLabel: windowLabelStr,
      grossCallsBuy,
      grossCallsSell,
      grossPutsBuy,
      grossPutsSell,
      grossTapeBuy,
      grossTapeSell,
    },
    scaleMax,
    hysteresis,
  };
}