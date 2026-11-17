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

export const FIXTURE_SPX_SPOT = 7540;
export const FIXTURE_MARKER = "AT_FIXTURE_SPX_0DTE_DEV_ONLY";

const EXPIRY = "2026-11-17";
const ROOT = "SPX";

function strikeRow(strike: number, callOi: number, putOi: number): {
  strike: number;
  call: OptionsContract;
  put: OptionsContract;
} {
  const exp = EXPIRY;
  const callKey = buildSchwabOptionKey(ROOT, exp, strike, "C");
  const putKey = buildSchwabOptionKey(ROOT, exp, strike, "P");
  return {
    strike,
    call: {
      strike,
      expiration: exp,
      schwabSymbol: callKey,
      streamKey: callKey,
      openInterest: callOi,
      gamma: 0.008 + (strike === 7550 ? 0.04 : 0.002),
      delta: strike >= FIXTURE_SPX_SPOT ? 0.45 : 0.55,
      bid: 3.5,
      ask: 3.7,
      volume: 1200,
    },
    put: {
      strike,
      expiration: exp,
      schwabSymbol: putKey,
      streamKey: putKey,
      openInterest: putOi,
      gamma: 0.008 + (strike === 7530 ? 0.04 : 0.002),
      delta: strike <= FIXTURE_SPX_SPOT ? -0.45 : -0.35,
      bid: 3.2,
      ask: 3.4,
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
      const mid = 3.6;
      const bid = mid - 0.05;
      const ask = mid + 0.05;
      const vol = side === row.call ? 3200 + row.strike % 100 : 2260 + row.strike % 80;
      ticks.push({
        key: side.streamKey,
        bid,
        ask,
        last: ask - 0.02,
        bidSize: 12,
        askSize: 10,
        volume: vol,
        openInterest: side.openInterest ?? null,
        iv: 0.14,
        delta: side.delta ?? null,
        gamma: side.gamma ?? null,
        theta: -0.08,
        vega: 0.12,
        mark: mid,
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

export const FIXTURE_REGIME = { label: "Bullish trend", degraded: false };
export const FIXTURE_CLASSIFIED_PCT = 0.74;
export const FIXTURE_HEADLINE = "Upward pressure · Price stalled";