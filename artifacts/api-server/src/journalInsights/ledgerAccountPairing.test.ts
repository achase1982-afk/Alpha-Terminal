import { describe, expect, it } from "vitest";
import { rebuildBook } from "./ledger.js";
import type { NormalizedActivity, NormalizedLeg, NormalizedOrder } from "./types.js";

function leg(over: Partial<NormalizedLeg> & Pick<NormalizedLeg, "instrumentKey" | "quantityDelta" | "price">): NormalizedLeg {
  return {
    assetClass: "option",
    underlying: "SPX",
    putCall: null,
    strike: null,
    expiration: null,
    multiplier: 100,
    fees: 0,
    effect: "open",
    ...over,
  };
}

function option(input: {
  underlying: string;
  expiration: string;
  right: "P" | "C";
  strike: number;
  delta: number;
  price: number;
  effect?: "open" | "close";
}): NormalizedLeg {
  const ymd = input.expiration.slice(2).replace(/-/g, "");
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return leg({
    instrumentKey: `${input.underlying}${ymd}${input.right}${strike}`,
    underlying: input.underlying,
    putCall: input.right === "P" ? "put" : "call",
    strike: input.strike,
    expiration: input.expiration,
    quantityDelta: input.delta,
    price: input.price,
    effect: input.effect ?? "open",
  });
}

function activity(
  accountRef: string,
  id: string,
  occurredAt: string,
  orderRef: string,
  legs: NormalizedLeg[],
): NormalizedActivity {
  return {
    id,
    accountRef,
    occurredAt,
    kind: "trade",
    netAmount: 0,
    fees: 0,
    orderRef,
    description: "",
    legs,
  };
}

function order(accountRef: string, id: string, enteredAt: string): NormalizedOrder {
  return { id, accountRef, enteredAt, closedAt: null, status: "filled", legs: [] };
}

describe("iron condor account pairing", () => {
  const t0 = Date.parse("2026-11-18T15:00:00.000Z");
  const expiration = "2026-11-20";

  it("keeps two accounts as separate verticals with their own P/L", () => {
    const book = rebuildBook({
      activities: [
        activity("A", "a-open", new Date(t0).toISOString(), "a-open", [
          option({ underlying: "SPX", expiration, right: "P", strike: 100, delta: -1, price: 2 }),
          option({ underlying: "SPX", expiration, right: "P", strike: 95, delta: 1, price: 1 }),
        ]),
        activity("A", "a-close", new Date(t0 + 30_000).toISOString(), "a-close", [
          option({ underlying: "SPX", expiration, right: "P", strike: 100, delta: 1, price: 1, effect: "close" }),
          option({ underlying: "SPX", expiration, right: "P", strike: 95, delta: -1, price: 0.5, effect: "close" }),
        ]),
        activity("B", "b-open", new Date(t0 + 60_000).toISOString(), "b-open", [
          option({ underlying: "SPX", expiration, right: "C", strike: 110, delta: -1, price: 3 }),
          option({ underlying: "SPX", expiration, right: "C", strike: 115, delta: 1, price: 1 }),
        ]),
        activity("B", "b-close", new Date(t0 + 90_000).toISOString(), "b-close", [
          option({ underlying: "SPX", expiration, right: "C", strike: 110, delta: 1, price: 2, effect: "close" }),
          option({ underlying: "SPX", expiration, right: "C", strike: 115, delta: -1, price: 1, effect: "close" }),
        ]),
      ],
      orders: [
        order("A", "a-open", new Date(t0).toISOString()),
        order("A", "a-close", new Date(t0 + 30_000).toISOString()),
        order("B", "b-open", new Date(t0 + 60_000).toISOString()),
        order("B", "b-close", new Date(t0 + 90_000).toISOString()),
      ],
    });

    expect(book.positions).toHaveLength(2);
    const byAccount = new Map(book.positions.map((position) => [position.accountRef, position]));
    expect(byAccount.get("A")?.strategy).toBe("Credit spreads (puts)");
    expect(byAccount.get("A")?.netPnl).toBe(50);
    expect(byAccount.get("B")?.strategy).toBe("Credit spreads (calls)");
    expect(byAccount.get("B")?.netPnl).toBe(100);
    expect(book.positions.some((position) => position.strategy.startsWith("Iron condors"))).toBe(false);
    expect(book.lots.every((lot) => byAccount.get(lot.accountRef)?.id === lot.positionId)).toBe(true);
  });

  it("still groups an overlapping condor on one account", () => {
    const book = rebuildBook({
      activities: [
        activity("A", "put", new Date(t0).toISOString(), "put", [
          option({ underlying: "SPX", expiration, right: "P", strike: 100, delta: -1, price: 2 }),
          option({ underlying: "SPX", expiration, right: "P", strike: 95, delta: 1, price: 1 }),
        ]),
        activity("A", "call", new Date(t0 + 60_000).toISOString(), "call", [
          option({ underlying: "SPX", expiration, right: "C", strike: 110, delta: -1, price: 1.8 }),
          option({ underlying: "SPX", expiration, right: "C", strike: 115, delta: 1, price: 1 }),
        ]),
      ],
      orders: [order("A", "put", new Date(t0).toISOString()), order("A", "call", new Date(t0 + 60_000).toISOString())],
    });
    expect(book.positions).toHaveLength(1);
    expect(book.positions[0]?.accountRef).toBe("A");
    expect(book.positions[0]?.strategy).toBe("Iron condors (credit)");
  });
});
