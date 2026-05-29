import { describe, it, expect } from "vitest";
import {
  computeExitPerLot,
  computeRiskFirstReward,
  computeEntryStockBand,
  confidenceTierColor,
  enrichExitTargets,
} from "../strategistCardEnrichment.js";

describe("computeExitPerLot", () => {
  it("fixes credit spread profit/stop per-lot (§7)", () => {
    const credit = 1.3;
    const profitBuyback = 0.5;
    const stopBuyback = 2.4;
    const r = computeExitPerLot({
      isCredit: true,
      netEntry: credit,
      profitBuyback,
      stopBuyback,
    });
    expect(r.profitPerLot).toBe(80);
    expect(r.stopPerLot).toBe(-110);
  });

  it("computes debit spread exit per-lot", () => {
    const debit = 2.0;
    const r = computeExitPerLot({
      isCredit: false,
      netEntry: debit,
      profitBuyback: 4.5,
      stopBuyback: 1.0,
    });
    expect(r.profitPerLot).toBe(250);
    expect(r.stopPerLot).toBeLessThan(0);
  });
});

describe("computeRiskFirstReward", () => {
  it("risk-first credit spread example", () => {
    const r = computeRiskFirstReward(130, 370);
    expect(r.display).toBe("2.85 : 1");
  });

  it("reward-favorable debit spread", () => {
    const r = computeRiskFirstReward(300, 200);
    expect(r.display).toBe("0.67 : 1");
  });

  it("open-ended when max profit unbounded", () => {
    const r = computeRiskFirstReward(99999, 500);
    expect(r.display).toBe("open-ended");
  });
});

describe("confidenceTierColor", () => {
  it("tiers at 70/65 boundaries", () => {
    expect(confidenceTierColor(72)).toBe("#46d486");
    expect(confidenceTierColor(67)).toBe("#ffd23f");
    expect(confidenceTierColor(50)).toBe("#ff7a7a");
  });
});

describe("computeEntryStockBand", () => {
  it("finds band for bull put credit spread", () => {
    const legs = [
      {
        type: "put" as const,
        side: "sell" as const,
        strike: 95,
        expiration: "2026-06-18",
        bid: 1.2,
        ask: 1.3,
        mid: 1.25,
        delta: -0.3,
        openInterest: 1000,
      },
      {
        type: "put" as const,
        side: "buy" as const,
        strike: 90,
        expiration: "2026-06-18",
        bid: 0.4,
        ask: 0.5,
        mid: 0.45,
        delta: -0.15,
        openInterest: 800,
      },
    ];
    const band = computeEntryStockBand({
      spot: 100,
      legs,
      fillMin: 0.7,
      fillMax: 0.9,
    });
    expect(band.min).not.toBeNull();
    expect(band.max).not.toBeNull();
    if (band.min != null && band.max != null) {
      expect(band.min).toBeLessThanOrEqual(band.max);
    }
  });
});

describe("enrichExitTargets", () => {
  it("derives profit pct for credit structure", () => {
    const e = enrichExitTargets({
      raw: {
        profitTarget: 0.5,
        profitTargetUnderlying: 0,
        stopLoss: 2.4,
        stopLossUnderlying: 0,
        timeStop: "",
      },
      isCredit: true,
      netEntry: 1.3,
      maxProfit: 130,
      maxLoss: 370,
    });
    expect(e.profitPerLot).toBe(80);
    expect(e.stopPerLot).toBe(-110);
    expect(e.profitTargetPct).toBeGreaterThan(0);
  });
});
