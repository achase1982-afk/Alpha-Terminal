import { describe, expect, it } from "vitest";
import { rebuildBook } from "./ledger.js";
import { accountComparison, buildInsights, type EquityPoint } from "./metrics.js";
import type { NormalizedActivity, NormalizedLeg } from "./types.js";

function stockRoundTrip(openedAt: string, closedAt: string): NormalizedActivity[] {
  const open: NormalizedLeg = {
    instrumentKey: "IBM",
    assetClass: "equity",
    underlying: "IBM",
    putCall: null,
    strike: null,
    expiration: null,
    quantityDelta: 1,
    price: 10,
    multiplier: 1,
    fees: 0,
    effect: "open",
  };
  const close: NormalizedLeg = { ...open, quantityDelta: -1, price: 10, effect: "close" };
  return [
    { id: "o", accountRef: "A", occurredAt: openedAt, kind: "trade", netAmount: 0, fees: 0, orderRef: null, description: "", legs: [open] },
    { id: "c", accountRef: "A", occurredAt: closedAt, kind: "trade", netAmount: 0, fees: 0, orderRef: null, description: "", legs: [close] },
  ];
}

function cash(id: string, accountRef: string, kind: "deposit" | "withdrawal", at: string, amount: number): NormalizedActivity {
  return { id, accountRef, occurredAt: at, kind, netAmount: amount, fees: 0, orderRef: null, description: "", legs: [] };
}

describe("account return boundaries", () => {
  const end = "2026-11-10T21:00:00.000Z";

  it("refuses mixed-account endpoints and a single snapshot", () => {
    const mixed = accountComparison({
      windowStart: "2026-11-01T21:00:00.000Z",
      windowEnd: end,
      snapshots: [
        { at: "2026-11-01T21:00:00.000Z", value: 1_000, accountRef: "A" },
        { at: "2026-11-10T21:00:00.000Z", value: 10_000, accountRef: "B" },
      ],
      activities: [],
    });
    expect(mixed.accountReturn).toBeNull();

    const once = accountComparison({
      windowStart: "2026-11-08T21:00:00.000Z",
      windowEnd: end,
      snapshots: [{ at: "2026-11-10T21:00:00.000Z", value: 2_000, accountRef: "A" }],
      activities: [],
    });
    expect(once.accountReturn).toBeNull();
  });

  it("returns 0% on unchanged equity and drops a deposit that falls before the first valuation", () => {
    const snapshots: EquityPoint[] = [
      { at: "2026-11-03T21:00:00.000Z", value: 2_000, accountRef: "A" },
      { at: "2026-11-10T21:00:00.000Z", value: 2_000, accountRef: "A" },
    ];
    const activities = [cash("dep", "A", "deposit", "2026-11-02T15:00:00.000Z", 1_000)];
    const compared = accountComparison({
      windowStart: "2026-11-01T21:00:00.000Z",
      windowEnd: end,
      snapshots,
      activities,
    });
    expect(compared.accountReturn).toBe(0);
    expect(compared.windowStart).toBe("2026-11-03T21:00:00.000Z");
    expect(compared.windowEnd).toBe("2026-11-10T21:00:00.000Z");

    const positions = rebuildBook({ activities: stockRoundTrip("2026-11-01T15:00:00.000Z", "2026-11-01T16:00:00.000Z") }).positions;
    const lifetime = buildInsights({
      positions,
      activities,
      period: "lifetime",
      asOf: end,
      snapshots,
      benchmark: [
        { date: "2026-11-03", adjustedClose: 100 },
        { date: "2026-11-10", adjustedClose: 100 },
      ],
    });
    expect(lifetime.comparison.accountReturn).toBe(0);
    expect(lifetime.comparison.footnote).toContain("Nov 3 – Nov 10, 2026");
    expect(lifetime.comparison.benchmarkReturn).toBe(0);

    const ytd = buildInsights({
      positions,
      activities,
      period: "ytd",
      asOf: end,
      snapshots,
      benchmark: [],
    });
    expect(ytd.comparison.accountReturn).toBeNull();
    expect(ytd.comparison.footnote).toContain("Account return unavailable");
  });

  it("returns 0% for a complete account set and ignores an internal transfer on YTD and lifetime", () => {
    const snapshots: EquityPoint[] = [
      { at: "2026-01-02T21:00:00.000Z", value: 4_000, accountRef: "A" },
      { at: "2026-01-02T21:00:00.000Z", value: 6_000, accountRef: "B" },
      { at: "2026-11-18T21:00:00.000Z", value: 3_000, accountRef: "A" },
      { at: "2026-11-18T21:00:00.000Z", value: 7_000, accountRef: "B" },
    ];
    const transfer = [
      cash("out", "A", "withdrawal", "2026-06-01T15:00:00.000Z", 1_000),
      cash("in", "B", "deposit", "2026-06-01T15:00:00.000Z", 1_000),
    ];
    const external = [cash("in", "A", "deposit", "2026-06-01T15:00:00.000Z", 1_000)];
    const positions = rebuildBook({ activities: stockRoundTrip("2026-01-02T15:00:00.000Z", "2026-01-02T16:00:00.000Z") }).positions;
    for (const period of ["ytd", "lifetime"] as const) {
      const insights = buildInsights({
        positions,
        activities: transfer,
        period,
        asOf: "2026-11-18T21:00:00.000Z",
        snapshots,
        benchmark: [],
      });
      expect(insights.comparison.accountReturn, period).toBe(0);
      const withDeposit = buildInsights({
        positions,
        activities: external,
        period,
        asOf: "2026-11-18T21:00:00.000Z",
        snapshots,
        benchmark: [],
      });
      expect(withDeposit.comparison.accountReturn, period).not.toBe(0);
    }
  });
});
