/**
 * Dev/test fixture for Active Trader screenshots. Import only from `src/dev-only/*`.
 * Must not ship enabled in production (see `verify-at-fixture-prod` script).
 */

import type { OptionsContract } from "@/components/OptionsTab";
import type { AtExpirationGroup } from "@/components/active-trader/ActiveTraderView";
import type { OptionTick } from "@/lib/options-stream-store";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { seedFlowCountsForKey } from "@/lib/active-trader/flowClassifier";

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

export function seedSpxFixtureFlow(): void {
  const groups = buildSpxFixtureGroups();
  for (const row of groups[0].rows) {
    if (row.call?.streamKey) {
      const buy = row.strike === 7545 ? 3310 : 880;
      const sell = 220;
      seedFlowCountsForKey(row.call.streamKey, { buy, sell, even: 40, unknown: 30 }, 3000);
    }
    if (row.put?.streamKey) {
      const sell = row.strike === 7545 ? 2260 : 640;
      const buy = 180;
      seedFlowCountsForKey(row.put.streamKey, { buy, sell, even: 35, unknown: 25 }, 2800);
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