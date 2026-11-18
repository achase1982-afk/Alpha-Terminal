import type { OptionChainResponse } from "@workspace/api-client-react";
import type { OptionsContract } from "@/components/OptionsTab";
import type { AtExpirationGroup } from "@/components/active-trader/ActiveTraderView";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

export const FIXTURE_ES_SPOT = 5950.25;
const EXPIRY = "2026-11-18";
const ROOT = "/ES";

function row(strike: number, callBid: number, callAsk: number, putBid: number, putAsk: number) {
  const callKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "C");
  const putKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "P");
  const call: OptionsContract = {
    strike,
    expiration: EXPIRY,
    schwabSymbol: callKey,
    streamKey: callKey,
    openInterest: strike === 5950 ? 2200 : 600,
    gamma: 0.0012,
    delta: strike < FIXTURE_ES_SPOT ? 0.51 : 0.36,
    bid: callBid,
    ask: callAsk,
    volume: 180,
  };
  const put: OptionsContract = {
    strike,
    expiration: EXPIRY,
    schwabSymbol: putKey,
    streamKey: putKey,
    openInterest: strike === 5950 ? 1900 : 500,
    gamma: 0.0012,
    delta: strike > FIXTURE_ES_SPOT ? -0.49 : -0.31,
    bid: putBid,
    ask: putAsk,
    volume: 140,
  };
  return { strike, call, put };
}

export function buildEsFixtureGroups(): AtExpirationGroup[] {
  const strikes = [6000, 5990, 5980, 5970, 5960, 5950, 5940, 5930, 5920, 5910, 5900];
  const rows = strikes.map((s) => {
    const dist = Math.abs(s - FIXTURE_ES_SPOT);
    const mid = Math.max(0.8, 18 - dist * 1.2);
    const spr = s === 5950 ? 0.4 : 0.6;
    const callBid = +(mid - spr / 2).toFixed(2);
    const callAsk = +(mid + spr / 2).toFixed(2);
    const putMid = Math.max(0.8, mid * 0.95 + (s > FIXTURE_ES_SPOT ? 1.5 : 0));
    const putBid = +(putMid - 0.3).toFixed(2);
    const putAsk = +(putMid + 0.3).toFixed(2);
    return row(s, callBid, callAsk, putBid, putAsk);
  });
  return [
    {
      expiration: EXPIRY,
      dte: 0,
      dateLabel: "18 NOV 0D",
      rows,
    },
  ];
}

export function buildEsFixtureChain(): OptionChainResponse {
  const groups = buildEsFixtureGroups();
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  for (const r of groups[0].rows) {
    if (r.call) calls.push(r.call);
    if (r.put) puts.push(r.put);
  }
  return { calls, puts, underlyingPrice: FIXTURE_ES_SPOT } as OptionChainResponse;
}

export const FIXTURE_ES_ZONES: ZoneModel = {
  callWall: 5975,
  putWall: 5935,
  flip: 5958,
  netGexUsdPer1Pct: 210_000_000,
  env: "near_flip",
  asOfLabel: "fixture",
};