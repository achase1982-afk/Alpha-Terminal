/**
 * Dev/test fixture for Active Trader screenshots. Import only from `src/dev-only/*`.
 * Must not ship enabled in production (see `verify-at-fixture-prod` script).
 */

import type { OptionsContract } from "@/components/OptionsTab";
import type { AtExpirationGroup } from "@/components/active-trader/ActiveTraderView";
import type { OptionTick } from "@/lib/options-stream-store";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { seedFlowCountsForKey, type FlowLaneCounts } from "@/lib/active-trader/flowClassifier";
import {
  FIXTURE_BS,
  blackScholes,
  normCdf,
  spxQuoteFromTheoretical,
} from "./spxFixturePricing";

export const FIXTURE_SPX_SPOT = 7540;
export const FIXTURE_MARKER = "AT_FIXTURE_SPX_0DTE_DEV_ONLY";

const EXPIRY = "2026-11-17";
const ROOT = "SPX";

/** Per-strike greeks aligned with chain-order dev fixture (non-flat Θ/V on spreads). */
function fixtureGreeksForStrike(strike: number, isCall: boolean): { delta: number; gamma: number; theta: number; vega: number } {
  const table: Record<number, { c: { theta: number; vega: number; gamma: number }; p: { theta: number; vega: number; gamma: number } }> = {
    7525: { c: { theta: -0.44, vega: 0.12, gamma: 0.02 }, p: { theta: -0.28, vega: 0.09, gamma: 0.012 } },
    7530: { c: { theta: -0.46, vega: 0.13, gamma: 0.022 }, p: { theta: -0.32, vega: 0.11, gamma: 0.016 } },
    7535: { c: { theta: -0.48, vega: 0.14, gamma: 0.024 }, p: { theta: -0.34, vega: 0.12, gamma: 0.018 } },
    7540: { c: { theta: -0.5, vega: 0.15, gamma: 0.026 }, p: { theta: -0.36, vega: 0.13, gamma: 0.02 } },
    7545: { c: { theta: -0.48, vega: 0.14, gamma: 0.025 }, p: { theta: -0.35, vega: 0.13, gamma: 0.021 } },
    7550: { c: { theta: -0.45, vega: 0.13, gamma: 0.022 }, p: { theta: -0.33, vega: 0.12, gamma: 0.019 } },
    7555: { c: { theta: -0.4, vega: 0.11, gamma: 0.018 }, p: { theta: -0.31, vega: 0.11, gamma: 0.017 } },
    7560: { c: { theta: -0.35, vega: 0.09, gamma: 0.014 }, p: { theta: -0.29, vega: 0.1, gamma: 0.015 } },
  };
  const row = table[strike];
  const g = row ? (isCall ? row.c : row.p) : { theta: -0.08, vega: 0.12, gamma: 0.008 };
  return { delta: bsDelta(strike, isCall), gamma: g.gamma, theta: g.theta, vega: g.vega };
}

function bsDelta(strike: number, isCall: boolean): number {
  const { spot: S, T, r, sigma } = FIXTURE_BS;
  if (T <= 1e-9) return isCall ? (S > strike ? 1 : 0) : S < strike ? -1 : 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d = isCall ? normCdf(d1) : normCdf(d1) - 1;
  return Math.round(d * 1000) / 1000;
}

function strikeRow(strike: number, callOi: number, putOi: number): {
  strike: number;
  call: OptionsContract;
  put: OptionsContract;
} {
  const exp = EXPIRY;
  const callKey = buildSchwabOptionKey(ROOT, exp, strike, "C");
  const putKey = buildSchwabOptionKey(ROOT, exp, strike, "P");
  const callMid = blackScholes(
    FIXTURE_BS.spot,
    strike,
    FIXTURE_BS.T,
    FIXTURE_BS.r,
    FIXTURE_BS.sigma,
    true,
  );
  const putMid = blackScholes(
    FIXTURE_BS.spot,
    strike,
    FIXTURE_BS.T,
    FIXTURE_BS.r,
    FIXTURE_BS.sigma,
    false,
  );
  const callQ = spxQuoteFromTheoretical(callMid);
  const putQ = spxQuoteFromTheoretical(putMid);
  return {
    strike,
    call: {
      strike,
      expiration: exp,
      schwabSymbol: callKey,
      streamKey: callKey,
      openInterest: callOi,
      gamma: 0.008 + (strike === 7550 ? 0.04 : 0.002),
      delta: bsDelta(strike, true),
      bid: callQ.bid,
      ask: callQ.ask,
      volume: 1200,
    },
    put: {
      strike,
      expiration: exp,
      schwabSymbol: putKey,
      streamKey: putKey,
      openInterest: putOi,
      gamma: 0.008 + (strike === 7530 ? 0.04 : 0.002),
      delta: bsDelta(strike, false),
      bid: putQ.bid,
      ask: putQ.ask,
      volume: 1100,
    },
  };
}

export function buildSpxFixtureGroups(): AtExpirationGroup[] {
  const strikes: number[] = [];
  for (let s = 7560; s >= 7440; s -= 5) strikes.push(s);
  const rows = strikes.map((strike) => {
    const callOi = strike === 7550 ? 18000 : strike === 7545 ? 4200 : 800;
    const putOi = strike === 7530 ? 16000 : strike === 7535 ? 3800 : 750;
    return strikeRow(strike, callOi, putOi);
  });
  return [
    {
      expiration: EXPIRY,
      dte: 0,
      dateLabel: "Nov 17",
      rows,
    },
  ];
}

export function buildSpxFixtureTicks(): OptionTick[] {
  const groups = buildSpxFixtureGroups();
  const ticks: OptionTick[] = [];
  const now = Date.now();
  for (const row of groups[0].rows) {
    for (const side of [row.call, row.put]) {
      if (!side?.streamKey) continue;
      const isCall = side === row.call;
      const mid = blackScholes(
        FIXTURE_BS.spot,
        row.strike,
        FIXTURE_BS.T,
        FIXTURE_BS.r,
        FIXTURE_BS.sigma,
        isCall,
      );
      const q = spxQuoteFromTheoretical(mid);
      const vol = side === row.call ? 3200 + row.strike % 100 : 2260 + row.strike % 80;
      const greeks = fixtureGreeksForStrike(row.strike, isCall);
      ticks.push({
        key: side.streamKey,
        bid: q.bid,
        ask: q.ask,
        last: q.mark,
        bidSize: 12,
        askSize: 10,
        volume: vol,
        openInterest: side.openInterest ?? null,
        iv: FIXTURE_BS.sigma,
        delta: side.delta ?? greeks.delta,
        gamma: side.gamma ?? greeks.gamma,
        theta: greeks.theta,
        vega: greeks.vega,
        mark: q.mark,
        change: 0.1,
        lastSize: 12,
        underlyingPrice: FIXTURE_SPX_SPOT,
        quoteTime: now - 100,
        tradeTime: now - 50,
        ts: now,
      });
    }
  }
  return ticks;
}

function flowForStrike(strike: number, side: "call" | "put"): FlowLaneCounts & { prevVol: number } {
  const spot = FIXTURE_SPX_SPOT;
  const above = strike > spot;
  const dist = Math.abs(strike - spot);
  const wallBoost =
    (side === "call" && strike === 7550) || (side === "put" && strike === 7530)
      ? 2.8
      : strike === 7545
        ? 1.6
        : 1;

  if (side === "call") {
    const buy = Math.round((above ? 420 + dist * 18 : 90 + dist * 4) * wallBoost);
    const sell = Math.round((above ? 80 + dist * 2 : 240 + dist * 6) * (strike === 7550 ? 0.7 : 1));
    const even = strike % 15 === 0 ? 120 : 22;
    return { buy, sell, even, unknown: 18, prevVol: 4000 + buy + sell };
  }
  const sell = Math.round((!above ? 380 + dist * 22 : 70 + dist * 3) * wallBoost);
  const buy = Math.round((!above ? 95 + dist * 3 : 210 + dist * 5) * (strike === 7530 ? 0.75 : 1));
  const even = strike % 10 === 0 ? 95 : 16;
  return { buy, sell, even, unknown: 14, prevVol: 3800 + buy + sell };
}

export function seedSpxFixtureFlow(): void {
  const groups = buildSpxFixtureGroups();
  const ladderStrikes = new Set<number>();
  for (let s = 7560; s >= 7520; s -= 5) ladderStrikes.add(s);

  for (const row of groups[0].rows) {
    if (!ladderStrikes.has(row.strike)) continue;
    if (row.call?.streamKey) {
      const f = flowForStrike(row.strike, "call");
      seedFlowCountsForKey(
        row.call.streamKey,
        { buy: f.buy, sell: f.sell, even: f.even, unknown: f.unknown },
        f.prevVol,
      );
    }
    if (row.put?.streamKey) {
      const f = flowForStrike(row.strike, "put");
      seedFlowCountsForKey(
        row.put.streamKey,
        { buy: f.buy, sell: f.sell, even: f.even, unknown: f.unknown },
        f.prevVol,
      );
    }
  }
}

export const FIXTURE_ZONE_MODEL: ZoneModel = {
  callWall: 7550,
  putWall: 7530,
  flip: 7538,
  netGexUsdPer1Pct: 1.24e9,
  env: "damping",
  asOfLabel: "15:42",
};

/** Golden keep-away stats (2026 YTD, n=221) for dev fixture. */
export const FIXTURE_SPX_KEEPAWAY = {
  symbol: "SPX" as const,
  n: 221,
  startYmd: "2026-01-01",
  endYmd: "2026-11-17",
  lowSide: { median: 29.5, mean: 36.6 },
  highSide: { median: 24.2, mean: 34.6 },
};

export const FIXTURE_REGIME = { label: "Bullish trend", degraded: false };
export const FIXTURE_CLASSIFIED_PCT = 0.74;
export const FIXTURE_HEADLINE = "Upward pressure · Price stalled";