import type { OptionChainResponse } from "@workspace/api-client-react";
import type { OptionsContract } from "@/components/OptionsTab";
import type { AtExpirationGroup } from "@/components/active-trader/ActiveTraderView";
import type { OptionTick } from "@/lib/options-stream-store";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

export const FIXTURE_NVDA_SPOT = 182.42;
export const FIXTURE_NVDA_OPEN = 180.5;
const EXPIRY = "2026-11-18";
const ROOT = "NVDA";

function row(strike: number, callBid: number, callAsk: number, putBid: number, putAsk: number) {
  const callKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "C");
  const putKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "P");
  const call: OptionsContract = {
    strike,
    expiration: EXPIRY,
    schwabSymbol: callKey,
    streamKey: callKey,
    openInterest: strike === 182.5 ? 12400 : 2100,
    gamma: 0.04,
    delta: strike < FIXTURE_NVDA_SPOT ? 0.52 : 0.38,
    bid: callBid,
    ask: callAsk,
    volume: 890,
  };
  const put: OptionsContract = {
    strike,
    expiration: EXPIRY,
    schwabSymbol: putKey,
    streamKey: putKey,
    openInterest: strike === 182.5 ? 9800 : 1800,
    gamma: 0.04,
    delta: strike > FIXTURE_NVDA_SPOT ? -0.48 : -0.28,
    bid: putBid,
    ask: putAsk,
    volume: 620,
  };
  return { strike, call, put };
}

export function buildNvdaFixtureGroups(): AtExpirationGroup[] {
  const strikes = [192.5, 190, 187.5, 185, 182.5, 180, 177.5, 175, 172.5, 170, 167.5];
  const rows = strikes.map((s) => {
    const dist = Math.abs(s - FIXTURE_NVDA_SPOT);
    const mid = Math.max(0.04, 1.85 - dist * 0.22);
    const spr = s === 182.5 ? 0.03 : 0.05;
    const callBid = +(mid - spr / 2).toFixed(2);
    const callAsk = +(mid + spr / 2).toFixed(2);
    const putMid = Math.max(0.04, mid * 0.9 + (s > FIXTURE_NVDA_SPOT ? 0.12 : 0));
    const putBid = +(putMid - 0.02).toFixed(2);
    const putAsk = +(putMid + 0.02).toFixed(2);
    return row(s, callBid, callAsk, putBid, putAsk);
  });
  return [
    {
      expiration: EXPIRY,
      dte: 1,
      dateLabel: "18 NOV 1D",
      rows,
    },
  ];
}

export function buildNvdaFixtureChain(): OptionChainResponse {
  const groups = buildNvdaFixtureGroups();
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  for (const r of groups[0].rows) {
    if (r.call) calls.push(r.call);
    if (r.put) puts.push(r.put);
  }
  return { calls, puts, underlyingPrice: FIXTURE_NVDA_SPOT } as OptionChainResponse;
}

export function buildNvdaFixtureTicks(): OptionTick[] {
  const ticks: OptionTick[] = [];
  const now = Date.now();
  for (const r of buildNvdaFixtureGroups()[0].rows) {
    for (const leg of [r.call, r.put]) {
      if (!leg?.streamKey) continue;
      const mid =
        leg.bid != null && leg.ask != null ? (leg.bid + leg.ask) / 2 : (leg.bid ?? leg.ask ?? null);
      ticks.push({
        key: leg.streamKey,
        bid: leg.bid ?? null,
        ask: leg.ask ?? null,
        last: mid,
        mark: mid,
        bidSize: 12,
        askSize: 14,
        volume: 420,
        openInterest: leg.openInterest ?? null,
        iv: 0.52,
        delta: leg.delta ?? null,
        gamma: leg.gamma ?? null,
        theta: null,
        vega: null,
        change: 0,
        lastSize: 6,
        underlyingPrice: FIXTURE_NVDA_SPOT,
        quoteTime: now,
        tradeTime: now,
        ts: now,
      });
    }
  }
  return ticks;
}

export const FIXTURE_NVDA_ZONES: ZoneModel = {
  callWall: 185,
  putWall: 178,
  flip: 182,
  netGexUsdPer1Pct: 84_000_000,
  env: "amplifying",
  asOfLabel: "fixture",
};