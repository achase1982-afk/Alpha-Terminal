import { describe, it, expect } from "vitest";
import { filterContaminatedIvs, summarizeOptionsChain, type ChainContract } from "../strategistV2.js";

function baseContract(over: Partial<ChainContract>): ChainContract {
  return {
    strike: 100,
    expiration: "2026-06-20",
    type: "call",
    optionType: "CALL",
    bid: 2,
    ask: 2.1,
    mid: 2.05,
    delta: 0.5,
    openInterest: 100,
    volume: 50,
    impliedVolatility: 0.35,
    dte: 45,
    ...over,
  };
}

describe("filterContaminatedIvs", () => {
  it("nulls IV and preserves rawIv for wide spread vs mid", () => {
    const c = baseContract({ bid: 0.01, ask: 0.11, mid: 0.06, impliedVolatility: 0.4 });
    filterContaminatedIvs([c]);
    expect(c.rawIv).toBe(0.4);
    expect(c.impliedVolatility).toBeNull();
    expect(c.reconstructedIV).toBeNull();
  });

  it("nulls IV when raw IV exceeds 200% decimal ceiling", () => {
    const c = baseContract({ impliedVolatility: 2.5 });
    const { stats } = filterContaminatedIvs([c]);
    expect(stats.ivClampedReasons.ceilingClamp).toBe(1);
    expect(c.impliedVolatility).toBeNull();
    expect(c.rawIv).toBe(2.5);
  });

  it("nulls IV for low volume and counts reason", () => {
    const c = baseContract({ volume: 3 });
    const { stats } = filterContaminatedIvs([c]);
    expect(stats.ivClampedReasons.lowVolume).toBe(1);
    expect(c.impliedVolatility).toBeNull();
  });

  it("keeps liquid tight-quote contract unchanged", () => {
    const c = baseContract({});
    filterContaminatedIvs([c]);
    expect(c.impliedVolatility).toBe(0.35);
    expect(c.rawIv).toBe(0.35);
  });
});

function ymdUtcPlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("summarizeOptionsChain IV hygiene integration", () => {
  it("produces ivChainFilter and nullable termStructure5pt when front ATM is stripped", () => {
    const spot = 100;
    const expNear = ymdUtcPlusDays(5);
    const expFar = ymdUtcPlusDays(50);
    const chain: ChainContract[] = [
      {
        strike: 100,
        expiration: expNear,
        type: "call",
        optionType: "CALL",
        bid: 0.01,
        ask: 0.02,
        mid: 0.015,
        delta: 0.52,
        openInterest: 500,
        volume: 100,
        impliedVolatility: 2.8,
        dte: 5,
      },
      {
        strike: 100,
        expiration: expNear,
        type: "put",
        optionType: "PUT",
        bid: 0.01,
        ask: 0.02,
        mid: 0.015,
        delta: -0.48,
        openInterest: 500,
        volume: 100,
        impliedVolatility: 2.8,
        dte: 5,
      },
      {
        strike: 100,
        expiration: expFar,
        type: "call",
        optionType: "CALL",
        bid: 2,
        ask: 2.2,
        mid: 2.1,
        delta: 0.45,
        openInterest: 200,
        volume: 40,
        impliedVolatility: 0.32,
        dte: 110,
      },
      {
        strike: 100,
        expiration: expFar,
        type: "put",
        optionType: "PUT",
        bid: 1.9,
        ask: 2.1,
        mid: 2,
        delta: -0.42,
        openInterest: 200,
        volume: 35,
        impliedVolatility: 0.33,
        dte: 110,
      },
    ];
    const s = summarizeOptionsChain(chain, spot, {});
    expect(s.ivChainFilter.ivClampedCount).toBeGreaterThanOrEqual(2);
    expect(s.frontMonthIV).not.toBe(280);
    const nearPt = s.termStructure5pt.find((p) => p.expiry === expNear);
    expect(nearPt?.atmIV ?? null).toBeNull();
    const farPt = s.termStructure5pt.find((p) => p.expiry === expFar);
    expect(farPt?.atmIV != null && farPt.atmIV > 0 && farPt.atmIV < 80).toBe(true);
  });
});
