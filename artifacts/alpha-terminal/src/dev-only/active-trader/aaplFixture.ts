import type { OptionChainResponse } from "@workspace/api-client-react";
import type { OptionsContract } from "@/components/OptionsTab";
import type { AtExpirationGroup } from "@/components/active-trader/ActiveTraderView";
import type { OptionTick } from "@/lib/options-stream-store";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

export const FIXTURE_AAPL_SPOT = 350.51;
const EXPIRY = "2026-11-18";
const ROOT = "AAPL";

function row(strike: number, callBid: number, callAsk: number, putBid: number, putAsk: number) {
  const callKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "C");
  const putKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "P");
  const call: OptionsContract = {
    strike,
    expiration: EXPIRY,
    schwabSymbol: callKey,
    streamKey: callKey,
    openInterest: strike === 350 ? 4200 : 900,
    gamma: 0.02,
    delta: strike < FIXTURE_AAPL_SPOT ? 0.55 : 0.35,
    bid: callBid,
    ask: callAsk,
    volume: 400,
  };
  const put: OptionsContract = {
    strike,
    expiration: EXPIRY,
    schwabSymbol: putKey,
    streamKey: putKey,
    openInterest: strike === 350 ? 3800 : 700,
    gamma: 0.02,
    delta: strike > FIXTURE_AAPL_SPOT ? -0.45 : -0.25,
    bid: putBid,
    ask: putAsk,
    volume: 320,
  };
  return { strike, call, put };
}

export function buildAaplFixtureGroups(): AtExpirationGroup[] {
  const strikes = [362.5, 360, 357.5, 355, 352.5, 350, 347.5, 345, 342.5, 340, 337.5];
  const rows = strikes.map((s) => {
    const dist = Math.abs(s - FIXTURE_AAPL_SPOT);
    const mid = Math.max(0.03, 0.55 - dist * 0.08);
    const spr = s === 350 ? 0.02 : 0.04;
    const callBid = +(mid - spr / 2).toFixed(2);
    const callAsk = +(mid + spr / 2).toFixed(2);
    const putMid = Math.max(0.03, mid * 0.85 + (s > FIXTURE_AAPL_SPOT ? 0.1 : 0));
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

export function buildAaplFixtureChain(): OptionChainResponse {
  const groups = buildAaplFixtureGroups();
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  for (const r of groups[0].rows) {
    if (r.call) calls.push(r.call);
    if (r.put) puts.push(r.put);
  }
  return { calls, puts, underlyingPrice: FIXTURE_AAPL_SPOT } as OptionChainResponse;
}

export function buildAaplFixtureTicks(): OptionTick[] {
  const ticks: OptionTick[] = [];
  const now = Date.now();
  for (const r of buildAaplFixtureGroups()[0].rows) {
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
        bidSize: 8,
        askSize: 10,
        volume: 200,
        openInterest: leg.openInterest ?? null,
        iv: 0.28,
        delta: leg.delta ?? null,
        gamma: leg.gamma ?? null,
        theta: null,
        vega: null,
        change: 0,
        lastSize: 5,
        underlyingPrice: FIXTURE_AAPL_SPOT,
        quoteTime: now,
        tradeTime: now,
        ts: now,
      });
    }
  }
  return ticks;
}

/** Equity 1DTE — no gamma flip in fixture (matches sparse live data). */
export const FIXTURE_AAPL_ZONES: ZoneModel = {
  callWall: 355,
  putWall: 345,
  flip: null,
  netGexUsdPer1Pct: -12_000_000,
  env: "damping",
  asOfLabel: "fixture",
};