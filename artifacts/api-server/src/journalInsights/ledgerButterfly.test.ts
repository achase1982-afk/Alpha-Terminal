import { describe, expect, it } from "vitest";
import { rebuildBook } from "./ledger.js";
import { buildInsights } from "./metrics.js";
import type { NormalizedActivity, NormalizedLeg } from "./types.js";

function option(input: {
  expiration: string;
  right: "P" | "C";
  strike: number;
  delta: number;
  price: number;
  effect?: "open" | "close";
}): NormalizedLeg {
  const ymd = input.expiration.slice(2).replace(/-/g, "");
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return {
    instrumentKey: `SPX${ymd}${input.right}${strike}`,
    assetClass: "option",
    underlying: "SPX",
    putCall: input.right === "P" ? "put" : "call",
    strike: input.strike,
    expiration: input.expiration,
    quantityDelta: input.delta,
    price: input.price,
    multiplier: 100,
    fees: 0,
    effect: input.effect ?? "open",
  };
}

function activity(id: string, occurredAt: string, legs: NormalizedLeg[]): NormalizedActivity {
  return {
    id,
    accountRef: "A",
    occurredAt,
    kind: "trade",
    netAmount: 0,
    fees: 0,
    orderRef: id,
    description: "",
    legs,
  };
}

const expiration = "2026-11-20";

describe("iron butterfly classification", () => {
  it("counts a shared body as a butterfly and distinct shorts as a condor", () => {
    const butterfly = rebuildBook({
      activities: [
        activity("fly-open", "2026-11-02T15:00:00.000Z", [
          option({ expiration, right: "P", strike: 95, delta: 1, price: 1 }),
          option({ expiration, right: "P", strike: 100, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 100, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 105, delta: 1, price: 1 }),
        ]),
      ],
    });
    expect(butterfly.positions).toHaveLength(1);
    expect(butterfly.positions[0]?.strategy).toBe("Iron butterflies (credit)");

    const condor = rebuildBook({
      activities: [
        activity("condor-open", "2026-11-02T15:00:00.000Z", [
          option({ expiration, right: "P", strike: 95, delta: 1, price: 1 }),
          option({ expiration, right: "P", strike: 100, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 110, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 115, delta: 1, price: 1 }),
        ]),
      ],
    });
    expect(condor.positions[0]?.strategy).toBe("Iron condors (credit)");
  });

  it("sends closed P/L to the matching bucket without changing the combined net", () => {
    const book = rebuildBook({
      activities: [
        activity("fly-open", "2026-11-02T15:00:00.000Z", [
          option({ expiration, right: "P", strike: 95, delta: 1, price: 1 }),
          option({ expiration, right: "P", strike: 100, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 100, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 105, delta: 1, price: 1 }),
        ]),
        activity("fly-close", "2026-11-02T16:00:00.000Z", [
          option({ expiration, right: "P", strike: 95, delta: -1, price: 1, effect: "close" }),
          option({ expiration, right: "P", strike: 100, delta: 1, price: 1.6, effect: "close" }),
          option({ expiration, right: "C", strike: 100, delta: 1, price: 2, effect: "close" }),
          option({ expiration, right: "C", strike: 105, delta: -1, price: 1, effect: "close" }),
        ]),
        activity("condor-open", "2026-11-03T15:00:00.000Z", [
          option({ expiration, right: "P", strike: 95, delta: 1, price: 1 }),
          option({ expiration, right: "P", strike: 100, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 110, delta: -1, price: 2 }),
          option({ expiration, right: "C", strike: 115, delta: 1, price: 1 }),
        ]),
        activity("condor-close", "2026-11-03T16:00:00.000Z", [
          option({ expiration, right: "P", strike: 95, delta: -1, price: 1, effect: "close" }),
          option({ expiration, right: "P", strike: 100, delta: 1, price: 2.25, effect: "close" }),
          option({ expiration, right: "C", strike: 110, delta: 1, price: 2, effect: "close" }),
          option({ expiration, right: "C", strike: 115, delta: -1, price: 1, effect: "close" }),
        ]),
      ],
    });
    const fly = book.positions.find((position) => position.strategy === "Iron butterflies (credit)");
    const condor = book.positions.find((position) => position.strategy === "Iron condors (credit)");
    expect(fly?.netPnl).toBe(40);
    expect(condor?.netPnl).toBe(-25);

    const insights = buildInsights({
      positions: book.positions,
      activities: [],
      period: "lifetime",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots: [],
      benchmark: [],
    });
    const buckets = insights.strategies.map((row) => row.netPnl);
    expect(insights.strategies.map((row) => row.key).sort()).toEqual([
      "Iron butterflies (credit)",
      "Iron condors (credit)",
    ]);
    expect(buckets.reduce((sum, net) => sum + net, 0)).toBe(insights.headline?.netPnl);
    expect(insights.headline?.netPnl).toBe(15);
  });
});
