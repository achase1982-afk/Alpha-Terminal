import { describe, expect, it } from "vitest";
import { rebuildBook } from "./ledger.js";
import { buildInsights } from "./metrics.js";
import { PAIR_WINDOW_MS, type NormalizedActivity, type NormalizedLeg, type NormalizedOrder } from "./types.js";

function option(input: {
  right: "P" | "C";
  strike: number;
  delta: number;
  price: number;
  effect?: "open" | "close";
}): NormalizedLeg {
  const expiration = "2026-11-20";
  const ymd = expiration.slice(2).replace(/-/g, "");
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return {
    instrumentKey: `SPX${ymd}${input.right}${strike}`,
    assetClass: "option",
    underlying: "SPX",
    putCall: input.right === "P" ? "put" : "call",
    strike: input.strike,
    expiration,
    quantityDelta: input.delta,
    price: input.price,
    multiplier: 100,
    fees: 0,
    effect: input.effect ?? "open",
  };
}

function activity(
  id: string,
  occurredAt: string,
  legs: NormalizedLeg[],
  strategyRef?: string,
): NormalizedActivity {
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
    strategyRef: strategyRef ?? null,
  };
}

function order(id: string, enteredAt: string): NormalizedOrder {
  return { id, accountRef: "A", enteredAt, closedAt: null, status: "filled", legs: [] };
}

describe("iron condor open interval", () => {
  const openAt = "2026-11-18T15:00:00.000Z";
  const closeAt = "2026-11-18T15:01:00.000Z";
  const callAt = "2026-11-18T15:02:00.000Z";

  it("keeps a closed put spread and a later call spread apart, including the realized loss", () => {
    const book = rebuildBook({
      activities: [
        activity("put-open", openAt, [
          option({ right: "P", strike: 100, delta: -1, price: 2 }),
          option({ right: "P", strike: 95, delta: 1, price: 1 }),
        ]),
        activity("put-close", closeAt, [
          option({ right: "P", strike: 100, delta: 1, price: 4, effect: "close" }),
          option({ right: "P", strike: 95, delta: -1, price: 1, effect: "close" }),
        ]),
        activity("call-open", callAt, [
          option({ right: "C", strike: 110, delta: -1, price: 1.8 }),
          option({ right: "C", strike: 115, delta: 1, price: 1 }),
        ]),
      ],
      orders: [order("put-open", openAt), order("put-close", closeAt), order("call-open", callAt)],
    });
    const put = book.positions.find((position) => position.strategy === "Credit spreads (puts)");
    const call = book.positions.find((position) => position.strategy === "Credit spreads (calls)");
    expect(book.positions).toHaveLength(2);
    expect(put?.status).toBe("closed");
    expect(put?.netPnl).toBe(-200);
    expect(call?.status).toBe("open");
    expect(book.positions.some((position) => position.strategy.startsWith("Iron condors"))).toBe(false);

    const insights = buildInsights({
      positions: book.positions,
      activities: [],
      period: "lifetime",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots: [],
      benchmark: [],
    });
    expect(insights.headline?.netPnl).toBe(-200);
    expect(insights.headline?.closedTrades).toBe(1);
    expect(insights.strategies.map((row) => row.key)).toEqual(["Credit spreads (puts)"]);
  });

  it("still groups wings that are open at the same time", () => {
    const later = new Date(Date.parse(openAt) + 60_000).toISOString();
    const book = rebuildBook({
      activities: [
        activity("put", openAt, [
          option({ right: "P", strike: 100, delta: -1, price: 2 }),
          option({ right: "P", strike: 95, delta: 1, price: 1 }),
        ]),
        activity("call", later, [
          option({ right: "C", strike: 110, delta: -1, price: 1.8 }),
          option({ right: "C", strike: 115, delta: 1, price: 1 }),
        ]),
      ],
      orders: [order("put", openAt), order("call", later)],
    });
    expect(book.positions).toHaveLength(1);
    expect(book.positions[0]?.strategy).toBe("Iron condors (credit)");
  });

  it("pairs a shared strategy link past the proximity window and ignores a mismatched link", () => {
    const later = new Date(Date.parse(openAt) + PAIR_WINDOW_MS + 60_000).toISOString();
    const linked = rebuildBook({
      activities: [
        activity("put", openAt, [
          option({ right: "P", strike: 100, delta: -1, price: 2 }),
          option({ right: "P", strike: 95, delta: 1, price: 1 }),
        ], "structure-1"),
        activity("call", later, [
          option({ right: "C", strike: 110, delta: -1, price: 1.8 }),
          option({ right: "C", strike: 115, delta: 1, price: 1 }),
        ], "structure-1"),
      ],
      orders: [order("put", openAt), order("call", later)],
    });
    expect(linked.positions).toHaveLength(1);
    expect(linked.positions[0]?.strategy).toBe("Iron condors (credit)");

    const mismatched = rebuildBook({
      activities: [
        activity("put", openAt, [
          option({ right: "P", strike: 100, delta: -1, price: 2 }),
          option({ right: "P", strike: 95, delta: 1, price: 1 }),
        ], "structure-1"),
        activity("call", new Date(Date.parse(openAt) + 60_000).toISOString(), [
          option({ right: "C", strike: 110, delta: -1, price: 1.8 }),
          option({ right: "C", strike: 115, delta: 1, price: 1 }),
        ], "structure-2"),
      ],
      orders: [order("put", openAt), order("call", new Date(Date.parse(openAt) + 60_000).toISOString())],
    });
    expect(mismatched.positions).toHaveLength(2);
  });
});
