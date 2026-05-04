import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { filterContaminatedIvs, summarizeOptionsChain, type ChainContract } from "../strategistV2.js";
import * as schwabMarketHours from "../schwabMarketHours.js";

vi.mock("../schwabMarketHours.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../schwabMarketHours.js")>();
  return {
    ...actual,
    getEquityMarketSessionWithAsOf: vi.fn().mockResolvedValue({
      session: "open",
      asOf: "2026-05-01T12:00:00.000Z",
      sessionSource: "schwab",
    }),
  };
});

const mockedSession = vi.mocked(schwabMarketHours.getEquityMarketSessionWithAsOf);

beforeEach(() => {
  mockedSession.mockResolvedValue({ session: "open", asOf: "2026-05-01T12:00:00.000Z", sessionSource: "schwab" });
});

afterEach(() => {
  vi.clearAllMocks();
});

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
  it("nulls IV and preserves rawIv when spread exceeds mid (microstructure)", () => {
    const c = baseContract({ bid: 0.01, ask: 0.11, mid: 0.06, impliedVolatility: 0.4 });
    const { stats } = filterContaminatedIvs([c], 100, "open");
    expect(c.rawIv).toBe(0.4);
    expect(c.impliedVolatility).toBeNull();
    expect(c.reconstructedIV).toBeNull();
    expect(stats.ivClampedReasons.spreadExceedsMid).toBe(1);
    expect(stats.ivContaminationCountedClamps).toBe(1);
  });

  it("when session is closed, spreadExceedsMid still nulls IV but does not count toward contamination numerator", () => {
    const c = baseContract({ bid: 0.01, ask: 0.11, mid: 0.06, impliedVolatility: 0.4 });
    const { stats } = filterContaminatedIvs([c], 100, "closed");
    expect(stats.ivClampedReasons.spreadExceedsMid).toBe(1);
    expect(stats.ivClampedCount).toBe(1);
    expect(stats.ivContaminationCountedClamps).toBe(0);
    expect(c.impliedVolatility).toBeNull();
  });

  it("when session is closed, noLiquidity still nulls IV but does not count toward contamination numerator", () => {
    const c = baseContract({ volume: 0, openInterest: 5, impliedVolatility: 0.3, bid: 0.2, ask: 0.25, mid: 0.225 });
    const { stats } = filterContaminatedIvs([c], 100, "closed");
    expect(stats.ivClampedReasons.noLiquidity).toBe(1);
    expect(stats.ivContaminationCountedClamps).toBe(0);
    expect(c.impliedVolatility).toBeNull();
  });

  it("when session is closed, ceilingClamp still counts toward contamination numerator", () => {
    const c = baseContract({ impliedVolatility: 4.2, bid: 1, ask: 1.1 });
    const { stats } = filterContaminatedIvs([c], 100, "closed");
    expect(stats.ivClampedReasons.ceilingClamp).toBe(1);
    expect(stats.ivContaminationCountedClamps).toBe(1);
  });

  it("nulls IV when raw IV >= 4.0 decimal (ceilingClamp)", () => {
    const c = baseContract({ impliedVolatility: 4.2, bid: 1, ask: 1.1 });
    const { stats } = filterContaminatedIvs([c], 100, "open");
    expect(stats.ivClampedReasons.ceilingClamp).toBe(1);
    expect(c.impliedVolatility).toBeNull();
    expect(c.rawIv).toBe(4.2);
  });

  it("nulls IV for no liquidity (zero volume and OI < 10) with two-sided quotes", () => {
    const c = baseContract({ volume: 0, openInterest: 5, impliedVolatility: 0.3, bid: 0.2, ask: 0.25, mid: 0.225 });
    const { stats } = filterContaminatedIvs([c], 100, "open");
    expect(stats.ivClampedReasons.noLiquidity).toBe(1);
    expect(c.impliedVolatility).toBeNull();
  });

  it("keeps two-sided quote with zero volume but OI >= 10", () => {
    const c = baseContract({ volume: 0, openInterest: 50, impliedVolatility: 0.3, bid: 0.2, ask: 0.25, mid: 0.225 });
    filterContaminatedIvs([c], 100, "open");
    expect(c.impliedVolatility).toBe(0.3);
    expect(c.rawIv).toBe(0.3);
  });

  it("relaxes spreadExceedsMid in mid-wing band (5–15% from spot)", () => {
    const c = baseContract({
      strike: 110,
      bid: 0.01,
      ask: 0.16,
      mid: 0.085,
      impliedVolatility: 0.4,
    });
    const { stats } = filterContaminatedIvs([c], 100, "open");
    expect(c.impliedVolatility).toBe(0.4);
    expect(stats.ivClampedReasons.spreadExceedsMid).toBe(0);
  });

  it("keeps liquid tight-quote contract and attaches bsm recompute stats", () => {
    const c = baseContract({});
    const { stats } = filterContaminatedIvs([c], 100, "open");
    expect(c.impliedVolatility).toBe(0.35);
    expect(c.rawIv).toBe(0.35);
    expect(stats.bsmRecomputeStats.contractsRecomputed).toBe(1);
    expect(c.recomputedIvAvailable).toBe(true);
    expect(c.recomputedIv).not.toBeNull();
  });
});

function ymdUtcPlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("summarizeOptionsChain IV hygiene integration", () => {
  it("produces ivChainFilter and nullable termStructure5pt when front ATM is stripped", async () => {
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
    const s = await summarizeOptionsChain(chain, spot, {});
    expect(s.ivChainFilter.ivClampedCount).toBeGreaterThanOrEqual(2);
    expect(s.frontMonthIV).not.toBe(280);
    const nearPt = s.termStructure5pt.find((p) => p.expiry === expNear);
    expect(nearPt?.atmIV ?? null).toBeNull();
    const farPt = s.termStructure5pt.find((p) => p.expiry === expFar);
    expect(farPt?.atmIV != null && farPt.atmIV > 0 && farPt.atmIV < 80).toBe(true);
  });
});
