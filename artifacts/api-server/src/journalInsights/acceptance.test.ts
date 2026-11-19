import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { brokerEnvironment, isExcludedBook } from "./accounts.js";
import { buildJournalFixtures } from "./fixtureBook.js";
import { calendarDays, formatWindow, startOfYearEt } from "./clock.js";
import { isFlat, rebuildBook } from "./ledger.js";
import {
  benchmarkReturn,
  buildInsights,
  maxDrawdown,
  metricBlock,
  modifiedDietz,
  money,
  signedPct,
} from "./metrics.js";
import { normalizeActivity, parseOptionSymbol } from "./normalize.js";
import {
  ACTIVITY_WINDOW_MS,
  BENCHMARK_UNAVAILABLE,
  EMPTY_CLOSED,
  HISTORY_START_MS,
  ORDER_WINDOW_MS,
  PAIR_WINDOW_MS,
  SAMPLE_FLOOR,
  type NormalizedActivity,
  type NormalizedLeg,
  type NormalizedOrder,
} from "./types.js";
import { activityWindows, orderWindows, syncRange } from "./windows.js";

const ACCT = "book-1";

function leg(over: Partial<NormalizedLeg> & Pick<NormalizedLeg, "instrumentKey" | "quantityDelta" | "price">): NormalizedLeg {
  return {
    assetClass: "equity",
    underlying: "AAPL",
    putCall: null,
    strike: null,
    expiration: null,
    multiplier: 1,
    fees: 0,
    effect: null,
    ...over,
  };
}

function activity(
  over: Partial<NormalizedActivity> & Pick<NormalizedActivity, "id" | "occurredAt" | "legs">,
): NormalizedActivity {
  return {
    accountRef: ACCT,
    kind: "trade",
    netAmount: 0,
    fees: 0,
    orderRef: null,
    description: "",
    ...over,
  };
}

function order(id: string, enteredAt: string): NormalizedOrder {
  return { id, accountRef: ACCT, enteredAt, closedAt: null, status: "filled", legs: [] };
}

function option(input: {
  underlying: string;
  expiration: string;
  right: "P" | "C";
  strike: number;
  delta: number;
  price: number;
  effect?: "open" | "close" | null;
  fees?: number;
}): NormalizedLeg {
  const ymd = input.expiration.slice(2).replace(/-/g, "");
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return leg({
    instrumentKey: `${input.underlying}${ymd}${input.right}${strike}`,
    assetClass: "option",
    underlying: input.underlying,
    putCall: input.right === "P" ? "put" : "call",
    strike: input.strike,
    expiration: input.expiration,
    quantityDelta: input.delta,
    price: input.price,
    multiplier: 100,
    fees: input.fees ?? 0,
    effect: input.effect ?? "open",
  });
}

describe("journal ledger", () => {
  it("closes long stock FIFO and keeps a partial off the closed-trade count", () => {
    const open = [
      activity({
        id: "b1",
        occurredAt: "2026-03-02T15:00:00.000Z",
        legs: [leg({ instrumentKey: "AAPL", quantityDelta: 50, price: 10, effect: "open" })],
      }),
      activity({
        id: "b2",
        occurredAt: "2026-03-03T15:00:00.000Z",
        legs: [leg({ instrumentKey: "AAPL", quantityDelta: 50, price: 14, effect: "open" })],
      }),
      activity({
        id: "s1",
        occurredAt: "2026-03-04T15:00:00.000Z",
        legs: [leg({ instrumentKey: "AAPL", quantityDelta: -50, price: 12, effect: "close" })],
      }),
    ];
    const partial = rebuildBook({ activities: open });
    expect(partial.positions).toHaveLength(1);
    expect(partial.positions[0]?.status).toBe("partial");
    expect(partial.positions[0]?.netPnl).toBe(100);
    expect(partial.lots.find((lot) => lot.remainingQty > 0)?.openPrice).toBe(14);
    expect(metricBlock(partial.positions).closedTrades).toBe(0);

    const closed = rebuildBook({
      activities: [
        ...open,
        activity({
          id: "s2",
          occurredAt: "2026-03-05T15:00:00.000Z",
          legs: [leg({ instrumentKey: "AAPL", quantityDelta: -50, price: 14, effect: "close" })],
        }),
      ],
    });
    expect(closed.positions).toHaveLength(1);
    expect(closed.positions[0]?.status).toBe("closed");
    expect(closed.positions[0]?.netPnl).toBe(100);
    expect(metricBlock(closed.positions).closedTrades).toBe(1);
  });

  it("subtracts open and close fees from the closed net", () => {
    const book = rebuildBook({
      activities: [
        activity({
          id: "b",
          occurredAt: "2026-04-01T14:30:00.000Z",
          legs: [leg({ instrumentKey: "MSFT", quantityDelta: 2, price: 10, fees: 2, effect: "open" })],
        }),
        activity({
          id: "s",
          occurredAt: "2026-04-01T18:00:00.000Z",
          legs: [leg({ instrumentKey: "MSFT", quantityDelta: -2, price: 12, fees: 1, effect: "close" })],
        }),
      ],
    });
    expect(book.positions[0]?.grossPnl).toBe(4);
    expect(book.positions[0]?.fees).toBe(3);
    expect(book.positions[0]?.netPnl).toBe(1);
  });

  it("realizes a short option at expiration, assignment, exercise, and cash settlement", () => {
    const opened = "2026-11-17T14:30:00.000Z";
    const settledAt = "2026-11-18T21:00:00.000Z";
    const expired = rebuildBook({
      activities: [
        activity({
          id: "short-open",
          occurredAt: opened,
          orderRef: "so",
          legs: [option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7330, delta: -1, price: 1.5 })],
        }),
        activity({
          id: "short-exp",
          occurredAt: settledAt,
          kind: "expiration",
          description: "option expired",
          legs: [option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7330, delta: 1, price: 0, effect: "close" })],
        }),
      ],
    });
    expect(expired.positions).toHaveLength(1);
    expect(expired.positions[0]?.status).toBe("expired");
    expect(expired.positions[0]?.netPnl).toBe(150);
    expect(expired.positions[0]?.label).toBe("SPXW 18 Nov 7330P");

    const assigned = rebuildBook({
      activities: [
        activity({
          id: "asg-open",
          occurredAt: opened,
          orderRef: "ao",
          legs: [option({ underlying: "AAPL", expiration: "2026-11-18", right: "P", strike: 200, delta: -1, price: 3 })],
        }),
        activity({
          id: "asg",
          occurredAt: settledAt,
          kind: "assignment",
          description: "option assigned",
          legs: [
            option({ underlying: "AAPL", expiration: "2026-11-18", right: "P", strike: 200, delta: 1, price: 0, effect: "close" }),
            leg({ instrumentKey: "AAPL", underlying: "AAPL", quantityDelta: 100, price: 200, effect: "open" }),
          ],
        }),
      ],
    });
    const optionPos = assigned.positions.find((position) => position.assetClass === "option");
    const stockPos = assigned.positions.find((position) => position.assetClass === "equity");
    expect(optionPos?.status).toBe("assigned");
    expect(optionPos?.netPnl).toBe(300);
    expect(stockPos?.status).toBe("open");
    expect(stockPos?.quantity).toBe(100);

    const exercised = rebuildBook({
      activities: [
        activity({
          id: "ex-open",
          occurredAt: opened,
          orderRef: "eo",
          legs: [option({ underlying: "AAPL", expiration: "2026-11-18", right: "C", strike: 180, delta: 1, price: 4 })],
        }),
        activity({
          id: "ex",
          occurredAt: settledAt,
          kind: "exercise",
          description: "option exercised",
          legs: [
            option({ underlying: "AAPL", expiration: "2026-11-18", right: "C", strike: 180, delta: -1, price: 0, effect: "close" }),
            leg({ instrumentKey: "AAPL", quantityDelta: 100, price: 180, effect: "open" }),
          ],
        }),
      ],
    });
    expect(exercised.positions.find((position) => position.assetClass === "option")?.status).toBe("exercised");
    expect(exercised.positions.find((position) => position.assetClass === "option")?.netPnl).toBe(-400);

    const cash = rebuildBook({
      activities: [
        activity({
          id: "cash-open",
          occurredAt: opened,
          orderRef: "co",
          legs: [option({ underlying: "SPX", expiration: "2026-11-18", right: "C", strike: 5000, delta: -1, price: 2 })],
        }),
        activity({
          id: "cash",
          occurredAt: settledAt,
          kind: "cash_settlement",
          description: "cash settled",
          legs: [option({ underlying: "SPX", expiration: "2026-11-18", right: "C", strike: 5000, delta: 1, price: 5, effect: "close" })],
        }),
      ],
    });
    expect(cash.positions).toHaveLength(1);
    expect(cash.positions[0]?.status).toBe("settled");
    expect(cash.positions[0]?.netPnl).toBe(-300);
  });

  it("realizes a roll on the old strikes and opens the new strikes", () => {
    const book = rebuildBook({
      activities: [
        activity({
          id: "roll-open",
          occurredAt: "2026-10-01T14:30:00.000Z",
          orderRef: "old",
          legs: [
            option({ underlying: "SPX", expiration: "2026-10-16", right: "P", strike: 7300, delta: -1, price: 2 }),
            option({ underlying: "SPX", expiration: "2026-10-16", right: "P", strike: 7250, delta: 1, price: 1 }),
          ],
        }),
        activity({
          id: "roll",
          occurredAt: "2026-10-08T15:00:00.000Z",
          orderRef: "new",
          legs: [
            option({ underlying: "SPX", expiration: "2026-10-16", right: "P", strike: 7300, delta: 1, price: 0.4, effect: "close" }),
            option({ underlying: "SPX", expiration: "2026-10-16", right: "P", strike: 7250, delta: -1, price: 0.2, effect: "close" }),
            option({ underlying: "SPX", expiration: "2026-11-20", right: "P", strike: 7350, delta: -1, price: 2.2, effect: "open" }),
            option({ underlying: "SPX", expiration: "2026-11-20", right: "P", strike: 7300, delta: 1, price: 1.1, effect: "open" }),
          ],
        }),
      ],
      orders: [order("old", "2026-10-01T14:30:00.000Z"), order("new", "2026-10-08T15:00:00.000Z")],
    });
    const oldPos = book.positions.find((position) => position.rolledFromId == null && isFlat(position.status));
    const newPos = book.positions.find((position) => position.status === "open");
    expect(book.positions).toHaveLength(2);
    expect(oldPos?.status).toBe("closed");
    expect(oldPos?.netPnl).toBe(80);
    expect(newPos?.netPnl).toBe(0);
    expect(newPos?.rolledFromId).toBe(oldPos?.id);
    expect(newPos?.strategy).toBe("Credit spreads (puts)");
  });

  it("pairs opposite credit verticals into one iron condor inside 300 seconds", () => {
    const t0 = Date.parse("2026-11-02T14:30:00.000Z");
    const activities = (gapMs: number): NormalizedActivity[] => [
      activity({
        id: "put",
        occurredAt: new Date(t0).toISOString(),
        orderRef: "put",
        legs: [
          option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7335, delta: -1, price: 2 }),
          option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7330, delta: 1, price: 1.2 }),
        ],
      }),
      activity({
        id: "call",
        occurredAt: new Date(t0 + gapMs).toISOString(),
        orderRef: "call",
        legs: [
          option({ underlying: "SPXW", expiration: "2026-11-18", right: "C", strike: 7400, delta: -1, price: 1.8 }),
          option({ underlying: "SPXW", expiration: "2026-11-18", right: "C", strike: 7450, delta: 1, price: 1 }),
        ],
      }),
    ];

    const inside = rebuildBook({
      activities: activities(PAIR_WINDOW_MS),
      orders: [order("put", new Date(t0).toISOString()), order("call", new Date(t0 + PAIR_WINDOW_MS).toISOString())],
    });
    expect(inside.positions).toHaveLength(1);
    expect(inside.positions[0]?.strategy).toBe("Iron condors (credit)");
    expect(inside.positions[0]?.label).toContain("7335/7330P");
    expect(inside.positions[0]?.label).toContain("7400/7450C");

    const outside = rebuildBook({
      activities: activities(PAIR_WINDOW_MS + 1_000),
      orders: [order("put", new Date(t0).toISOString()), order("call", new Date(t0 + PAIR_WINDOW_MS + 1_000).toISOString())],
    });
    expect(outside.positions.map((position) => position.strategy).sort()).toEqual([
      "Credit spreads (calls)",
      "Credit spreads (puts)",
    ]);

    const sameTicket = rebuildBook({
      activities: [
        activity({
          id: "four",
          occurredAt: new Date(t0).toISOString(),
          orderRef: "four",
          legs: [
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7335, delta: -1, price: 2 }),
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7330, delta: 1, price: 1.2 }),
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "C", strike: 7400, delta: -1, price: 1.8 }),
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "C", strike: 7450, delta: 1, price: 1 }),
          ],
        }),
      ],
    });
    expect(sameTicket.positions).toHaveLength(1);
    expect(sameTicket.positions[0]?.strategy).toBe("Iron condors (credit)");
  });

  it("does not pair a credit vertical with a debit vertical", () => {
    const t0 = Date.parse("2026-11-02T14:30:00.000Z");
    const book = rebuildBook({
      activities: [
        activity({
          id: "put",
          occurredAt: new Date(t0).toISOString(),
          orderRef: "put",
          legs: [
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7335, delta: -1, price: 2 }),
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "P", strike: 7330, delta: 1, price: 1 }),
          ],
        }),
        activity({
          id: "call",
          occurredAt: new Date(t0 + 1_000).toISOString(),
          orderRef: "call",
          legs: [
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "C", strike: 7450, delta: -1, price: 1 }),
            option({ underlying: "SPXW", expiration: "2026-11-18", right: "C", strike: 7400, delta: 1, price: 1.8 }),
          ],
        }),
      ],
      orders: [order("put", new Date(t0).toISOString()), order("call", new Date(t0 + 1_000).toISOString())],
    });
    expect(book.positions).toHaveLength(2);
    expect(book.positions.map((position) => position.strategy).sort()).toEqual([
      "Credit spreads (puts)",
      "Debit spreads",
    ]);
  });

  it("classifies credit and debit by strike geometry", () => {
    const putDebit = rebuildBook({
      activities: [
        activity({
          id: "pd",
          occurredAt: "2026-05-01T14:30:00.000Z",
          legs: [
            option({ underlying: "QQQ", expiration: "2026-05-15", right: "P", strike: 400, delta: -1, price: 1 }),
            option({ underlying: "QQQ", expiration: "2026-05-15", right: "P", strike: 410, delta: 1, price: 3 }),
          ],
        }),
      ],
    });
    expect(putDebit.positions[0]?.strategy).toBe("Debit spreads");

    const callCredit = rebuildBook({
      activities: [
        activity({
          id: "cc",
          occurredAt: "2026-05-01T14:30:00.000Z",
          legs: [
            option({ underlying: "QQQ", expiration: "2026-05-15", right: "C", strike: 450, delta: -1, price: 2 }),
            option({ underlying: "QQQ", expiration: "2026-05-15", right: "C", strike: 455, delta: 1, price: 1 }),
          ],
        }),
      ],
    });
    expect(callCredit.positions[0]?.strategy).toBe("Credit spreads (calls)");
  });

  it("merges a later pure open of the same instrument into the open position", () => {
    const book = rebuildBook({
      activities: [
        activity({
          id: "a",
          occurredAt: "2026-02-02T15:00:00.000Z",
          legs: [leg({ instrumentKey: "NVDA", quantityDelta: 10, price: 100, effect: "open" })],
        }),
        activity({
          id: "b",
          occurredAt: "2026-02-03T15:00:00.000Z",
          legs: [leg({ instrumentKey: "NVDA", quantityDelta: 5, price: 110, effect: "open" })],
        }),
      ],
    });
    expect(book.positions).toHaveLength(1);
    expect(book.positions[0]?.quantity).toBe(15);
    expect(book.positions[0]?.status).toBe("open");
  });

  it("leaves an open position open when nothing in the ledger closes it", () => {
    const book = rebuildBook({
      activities: [
        activity({
          id: "still-open",
          occurredAt: "2026-08-03T14:00:00.000Z",
          description: "manual result flag is not a close",
          legs: [leg({ instrumentKey: "AMD", quantityDelta: 10, price: 80, effect: "open" })],
        }),
      ],
    });
    expect(book.positions[0]?.status).toBe("open");
    expect(book.positions[0]?.closedAt).toBeNull();
  });
});

describe("journal metrics", () => {
  it("computes expectancy, profit factor, averages, positive share, fees, and max drawdown", () => {
    const drawdown = maxDrawdown([
      { at: "2026-01-01T00:00:00.000Z", net: 100 },
      { at: "2026-01-02T00:00:00.000Z", net: -50 },
      { at: "2026-01-03T00:00:00.000Z", net: 20 },
      { at: "2026-01-04T00:00:00.000Z", net: -80 },
    ]);
    expect(drawdown).toBe(-110);

    const positions = [100, -50, 0, 40, -10].map((net, index) => {
      const symbol = `T${index}`;
      const opened = `2026-06-${String(index + 1).padStart(2, "0")}T15:00:00.000Z`;
      const closedAt = `2026-06-${String(index + 1).padStart(2, "0")}T18:00:00.000Z`;
      return rebuildBook({
        activities: [
          activity({
            id: `${symbol}-o`,
            occurredAt: opened,
            legs: [leg({ instrumentKey: symbol, quantityDelta: 1, price: 10, fees: 1, effect: "open" })],
          }),
          activity({
            id: `${symbol}-c`,
            occurredAt: closedAt,
            legs: [leg({ instrumentKey: symbol, quantityDelta: -1, price: 11 + net, fees: 0, effect: "close" })],
          }),
        ],
      }).positions[0]!;
    });
    const metrics = metricBlock(positions);
    expect(metrics.closedTrades).toBe(5);
    expect(metrics.netPnl).toBe(80);
    expect(metrics.expectancy).toBe(16);
    expect(metrics.avgGain).toBe(70);
    expect(metrics.avgLoss).toBe(-30);
    expect(metrics.profitFactor).toBe(2.33);
    expect(metrics.pctClosedPositive).toBeCloseTo(2 / 5);
    expect(metrics.fees).toBe(5);
    expect(metrics.maxDrawdown).toBe(-50);
  });

  it("flags samples below 30 closed trades", () => {
    const make = (count: number) => {
      const activities: NormalizedActivity[] = [];
      for (let i = 0; i < count; i += 1) {
        const symbol = `S${i}`;
        activities.push(
          activity({
            id: `${symbol}-o`,
            occurredAt: `2026-04-01T14:${String(i % 60).padStart(2, "0")}:00.000Z`,
            legs: [leg({ instrumentKey: symbol, quantityDelta: 1, price: 5, effect: "open" })],
          }),
          activity({
            id: `${symbol}-c`,
            occurredAt: `2026-04-01T16:${String(i % 60).padStart(2, "0")}:00.000Z`,
            legs: [leg({ instrumentKey: symbol, quantityDelta: -1, price: 6, effect: "close" })],
          }),
        );
      }
      return buildInsights({
        positions: rebuildBook({ activities }).positions,
        activities: [],
        period: "ytd",
        asOf: "2026-11-18T21:00:00.000Z",
        snapshots: [],
        benchmark: [],
      });
    };
    expect(SAMPLE_FLOOR).toBe(30);
    expect(make(29).strategies[0]?.sample).toBe("short");
    expect(make(30).strategies[0]?.sample).toBe("enough");
  });

  it("splits time, holding, and weekday from the opening ticket", () => {
    const activities: NormalizedActivity[] = [
      activity({
        id: "early-o",
        occurredAt: "2026-11-18T18:59:00.000Z",
        orderRef: "early",
        legs: [leg({ instrumentKey: "E", quantityDelta: 1, price: 10, effect: "open" })],
      }),
      activity({
        id: "early-c",
        occurredAt: "2026-11-18T19:10:00.000Z",
        legs: [leg({ instrumentKey: "E", quantityDelta: -1, price: 11, effect: "close" })],
      }),
      activity({
        id: "late-o",
        occurredAt: "2026-11-18T19:00:00.000Z",
        orderRef: "late",
        legs: [leg({ instrumentKey: "L", quantityDelta: 1, price: 10, effect: "open" })],
      }),
      activity({
        id: "late-c",
        occurredAt: "2026-11-18T19:40:00.000Z",
        legs: [leg({ instrumentKey: "L", quantityDelta: -1, price: 9, effect: "close" })],
      }),
      activity({
        id: "mon-o",
        occurredAt: "2026-11-16T15:00:00.000Z",
        orderRef: "mon",
        legs: [leg({ instrumentKey: "M", quantityDelta: 1, price: 10, effect: "open" })],
      }),
      activity({
        id: "mon-c",
        occurredAt: "2026-11-17T15:00:00.000Z",
        legs: [leg({ instrumentKey: "M", quantityDelta: -1, price: 12, effect: "close" })],
      }),
    ];
    const insights = buildInsights({
      positions: rebuildBook({
        activities,
        orders: [
          order("early", "2026-11-18T18:59:00.000Z"),
          order("late", "2026-11-18T19:00:00.000Z"),
          order("mon", "2026-11-16T15:00:00.000Z"),
        ],
      }).positions,
      activities: [],
      period: "lifetime",
      asOf: "2026-11-18T22:00:00.000Z",
      snapshots: [],
      benchmark: [],
    });
    const before = insights.account?.timeCuts.find((cut) => cut.key === "before_2pm");
    const after = insights.account?.timeCuts.find((cut) => cut.key === "after_2pm");
    expect(before?.trades).toBe(2);
    expect(after?.trades).toBe(1);
    expect(insights.account?.holdingCuts.find((cut) => cut.key === "under_30")?.trades).toBe(1);
    expect(insights.account?.holdingCuts.find((cut) => cut.key === "to_close")?.trades).toBe(1);
    expect(insights.account?.holdingCuts.find((cut) => cut.key === "overnight")?.trades).toBe(1);
    expect(insights.account?.dayCuts.find((cut) => cut.key === "wed")?.trades).toBe(2);
    expect(insights.account?.dayCuts.find((cut) => cut.key === "mon")?.trades).toBe(1);
    expect(insights.account?.perspective ?? "").not.toMatch(/win rate|\bwins\b|W\/L|streak/i);
    expect(insights.byStrategy.Equities?.perspective).toContain("Before 2:00 PM ET");
    expect(insights.byStrategy.Equities?.closedTrades[0]?.detail).toMatch(/ET · closed /);
  });

  it("uses Modified Dietz and withholds a return when equity snapshots are missing", () => {
    expect(calendarDays("2026-01-02", "2026-11-18")).toBe(320);
    const ret = modifiedDietz({
      beginning: 100_000,
      ending: 110_000,
      start: "2026-01-02T00:00:00.000Z",
      end: "2026-11-18T00:00:00.000Z",
      flows: [{ at: "2026-06-01T00:00:00.000Z", amount: 5_000 }],
    });
    expect(ret).toBeCloseTo(5_000 / 102_656.25, 8);

    const depositOnTheBoundary = modifiedDietz({
      beginning: 100,
      ending: 200,
      start: "2026-01-02T00:00:00.000Z",
      end: "2026-11-18T00:00:00.000Z",
      flows: [{ at: "2026-01-02T00:00:00.000Z", amount: 50 }],
    });
    expect(depositOnTheBoundary).toBe(1);
    expect(modifiedDietz({
      beginning: 0,
      ending: 10,
      start: "2026-01-02T00:00:00.000Z",
      end: "2026-06-01T00:00:00.000Z",
      flows: [],
    })).toBeNull();

    const closed = rebuildBook({
      activities: [
        activity({
          id: "y-o",
          occurredAt: "2026-02-02T15:00:00.000Z",
          legs: [leg({ instrumentKey: "IBM", quantityDelta: 1, price: 10, effect: "open" })],
        }),
        activity({
          id: "y-c",
          occurredAt: "2026-02-03T15:00:00.000Z",
          legs: [leg({ instrumentKey: "IBM", quantityDelta: -1, price: 12, effect: "close" })],
        }),
      ],
    }).positions;
    const activities = [
      activity({ id: "dep", occurredAt: "2026-06-01T15:00:00.000Z", kind: "deposit", netAmount: 5_000, legs: [] }),
      activity({ id: "trade-cash", occurredAt: "2026-03-01T15:00:00.000Z", kind: "trade", netAmount: 9_999, legs: [] }),
    ];
    const snapshots = [
      { at: "2026-02-03T21:00:00.000Z", value: 100_000 },
      { at: "2026-11-18T21:00:00.000Z", value: 110_000 },
    ];
    const withDeposit = buildInsights({
      positions: closed,
      activities,
      period: "lifetime",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots,
      benchmark: [],
    });
    const onlyDeposit = buildInsights({
      positions: closed,
      activities: activities.filter((row) => row.kind === "deposit"),
      period: "lifetime",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots,
      benchmark: [],
    });
    const withoutFlows = buildInsights({
      positions: closed,
      activities: [],
      period: "lifetime",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots,
      benchmark: [],
    });
    expect(withDeposit.comparison.accountReturn).toBeCloseTo(onlyDeposit.comparison.accountReturn ?? Number.NaN, 8);
    expect(withDeposit.comparison.accountReturn).not.toBeCloseTo(withoutFlows.comparison.accountReturn ?? Number.NaN, 4);

    const noSnapshot = buildInsights({
      positions: closed,
      activities,
      period: "ytd",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots: [],
      benchmark: [{ date: "2026-01-02", adjustedClose: 100 }],
    });
    expect(noSnapshot.comparison.accountReturn).toBeNull();
    expect(noSnapshot.comparison.benchmarkStatus).toBe("unavailable");
    expect(noSnapshot.comparison.benchmarkReturn).toBeNull();
    expect(noSnapshot.comparison.footnote.toLowerCase()).toContain("benchmark unavailable");
  });

  it("compares the same dates with adjusted total return and says when the benchmark is missing", () => {
    const ret = benchmarkReturn(
      [
        { date: "2026-01-02", adjustedClose: 500 },
        { date: "2026-11-18", adjustedClose: 571 },
      ],
      "2026-01-02",
      "2026-11-18",
    );
    expect(ret).toBeCloseTo(571 / 500 - 1, 8);
    expect(benchmarkReturn([{ date: "2026-11-18", adjustedClose: 571 }], "2026-01-02", "2026-11-18")).toBeNull();
    expect(BENCHMARK_UNAVAILABLE).toBe("Benchmark unavailable.");
  });

  it("keeps prior-year closes out of YTD and refuses an empty book", () => {
    const prior = rebuildBook({
      activities: [
        activity({
          id: "old-o",
          occurredAt: "2025-12-15T15:00:00.000Z",
          legs: [leg({ instrumentKey: "OLD", quantityDelta: 1, price: 10, effect: "open" })],
        }),
        activity({
          id: "old-c",
          occurredAt: "2025-12-31T23:00:00.000Z",
          legs: [leg({ instrumentKey: "OLD", quantityDelta: -1, price: 20, effect: "close" })],
        }),
        activity({
          id: "new-o",
          occurredAt: "2026-01-05T15:00:00.000Z",
          legs: [leg({ instrumentKey: "NEW", quantityDelta: 1, price: 10, effect: "open" })],
        }),
        activity({
          id: "new-c",
          occurredAt: "2026-01-06T15:00:00.000Z",
          legs: [leg({ instrumentKey: "NEW", quantityDelta: -1, price: 8, effect: "close" })],
        }),
      ],
    }).positions;
    const ytd = buildInsights({
      positions: prior,
      activities: [],
      period: "ytd",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots: [],
      benchmark: [],
    });
    expect(startOfYearEt("2026-11-18T21:00:00.000Z")).toBe("2026-01-01T05:00:00.000Z");
    expect(ytd.headline?.netPnl).toBe(-2);
    expect(ytd.headline?.label).toBe("IN THE RED");
    expect(ytd.headline?.tone).toBe("negative");
    expect(ytd.account?.metrics.closedTrades).toBe(1);

    const openOnly = rebuildBook({
      activities: [
        activity({
          id: "o",
          occurredAt: "2026-11-18T15:00:00.000Z",
          legs: [leg({ instrumentKey: "OPEN", quantityDelta: 4, price: 10, effect: "open" })],
        }),
      ],
      marks: { OPEN: 12 },
    });
    const empty = buildInsights({
      positions: openOnly.positions,
      activities: [],
      period: "ytd",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots: [],
      benchmark: [
        { date: "2026-01-02", adjustedClose: 100 },
        { date: "2026-11-18", adjustedClose: 110 },
      ],
    });
    expect(empty.empty).toBe(true);
    expect(empty.emptyMessage).toBe(EMPTY_CLOSED);
    expect(empty.headline).toBeNull();
    expect(empty.account).toBeNull();
    expect(empty.comparison.openPositions).toBe(1);
    expect(empty.comparison.unrealizedPnl).toBe(8);
    expect(empty.positions).toHaveLength(1);
    expect(empty.positions[0]?.statusLabel).toBe("Open");

    const unmarked = rebuildBook({
      activities: [
        activity({
          id: "o",
          occurredAt: "2026-11-18T15:00:00.000Z",
          legs: [leg({ instrumentKey: "OPEN", quantityDelta: 4, price: 10, effect: "open" })],
        }),
      ],
    });
    const noMark = buildInsights({
      positions: unmarked.positions,
      activities: [],
      period: "lifetime",
      asOf: "2026-11-18T21:00:00.000Z",
      snapshots: [],
      benchmark: [],
    });
    expect(noMark.comparison.unrealizedPnl).toBeNull();
    expect(noMark.comparison.footnote).not.toMatch(/\$\d/);
    expect(noMark.comparison.footnote).toContain("unrealized not included above");
  });

  it("formats signed money and percent without inventing a zero return", () => {
    expect(money(1840)).toBe("+$1,840.00");
    expect(money(-3840)).toBe("-$3,840.00");
    expect(money(0)).toBe("$0.00");
    expect(signedPct(0.142)).toBe("+14.2%");
    expect(signedPct(-0.024)).toBe("-2.4%");
    expect(signedPct(null)).toBe("—");
    expect(formatWindow("2026-01-02", "2026-11-18")).toBe("Jan 2 – Nov 18, 2026");
  });
});

describe("journal ingestion boundaries", () => {
  it("drops paper and sandbox books", () => {
    expect(isExcludedBook({ type: "PAPER" })).toBe(true);
    expect(isExcludedBook({ accountNumber: "paper-88" })).toBe(true);
    expect(isExcludedBook({ baseUrl: "https://example.test/sandbox" })).toBe(true);
    expect(isExcludedBook({ environment: "sandbox" })).toBe(true);
    expect(isExcludedBook({ type: "MARGIN", accountNumber: "12345678", baseUrl: "https://api.example.test" })).toBe(false);
    const prior = process.env.BROKER_ENVIRONMENT;
    process.env.BROKER_ENVIRONMENT = "sandbox";
    expect(brokerEnvironment()).toBe("sandbox");
    expect(isExcludedBook({ environment: brokerEnvironment() })).toBe(true);
    if (prior == null) delete process.env.BROKER_ENVIRONMENT;
    else process.env.BROKER_ENVIRONMENT = prior;
  });

  it("backfills from the beginning and overlaps two days once that backfill is done", () => {
    const now = new Date("2026-11-18T21:00:00.000Z");
    const fresh = syncRange({ syncedThrough: null, backfillComplete: false, now });
    expect(fresh.mode).toBe("backfill");
    expect(fresh.start.getTime()).toBe(HISTORY_START_MS);
    const resume = syncRange({ syncedThrough: "2024-01-01T00:00:00.000Z", backfillComplete: false, now });
    expect(resume.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    const incremental = syncRange({ syncedThrough: "2026-11-18T00:00:00.000Z", backfillComplete: true, now });
    expect(incremental.mode).toBe("incremental");
    expect(incremental.start.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    const orders = orderWindows({ start: new Date("2026-07-01T00:00:00.000Z"), end: new Date("2026-11-18T00:00:00.000Z") });
    expect(orders.length).toBeGreaterThan(1);
    expect(orders[0]!.end.getTime() - orders[0]!.start.getTime()).toBe(ORDER_WINDOW_MS);
    const activities = activityWindows({ start: new Date("2024-01-01T00:00:00.000Z"), end: new Date("2026-11-18T00:00:00.000Z") });
    expect(activities.length).toBeGreaterThan(1);
    expect(activities[0]!.end.getTime() - activities[0]!.start.getTime()).toBe(ACTIVITY_WINDOW_MS);
  });

  it("reads option symbols and fee items from history payloads", () => {
    expect(parseOptionSymbol("SPXW  261118P07335000")).toMatchObject({
      underlying: "SPXW",
      expiration: "2026-11-18",
      putCall: "put",
      strike: 7335,
    });
    const normalized = normalizeActivity({
      activityId: "raw-1",
      time: "2026-11-18T14:42:00.000Z",
      type: "TRADE",
      description: "spread",
      netAmount: 65,
      orderId: 99,
      transferItems: [
        {
          instrument: { assetType: "OPTION", symbol: "SPXW  261118P07335000", underlyingSymbol: "SPXW", putCall: "PUT" },
          amount: -1,
          price: 1.5,
          positionEffect: "OPENING",
        },
        {
          instrument: { assetType: "CURRENCY", symbol: "USD" },
          amount: -1.15,
          feeType: "COMMISSION",
        },
      ],
    }, ACCT);
    expect(normalized?.kind).toBe("trade");
    expect(normalized?.orderRef).toBe("99");
    expect(normalized?.fees).toBeCloseTo(1.15);
    expect(normalized?.legs).toHaveLength(1);
    expect(normalized?.legs[0]?.effect).toBe("open");
    expect(normalized?.legs[0]?.strike).toBe(7335);
    const deposit = normalizeActivity({
      activityId: "cash-in",
      time: "2026-06-01T14:00:00.000Z",
      type: "ELECTRONIC_FUND",
      netAmount: 5000,
      transferItems: [],
    }, ACCT);
    expect(deposit?.kind).toBe("deposit");
    expect(deposit?.legs).toHaveLength(0);
  });
});

describe("journal example book", () => {
  it("builds a labeled example book from the ledger", () => {
    const { insights, empty } = buildJournalFixtures();
    expect(insights.empty).toBe(false);
    expect(insights.headline?.tone).toBe("negative");
    expect(insights.headline?.label).toBe("IN THE RED");
    const puts = insights.strategies.find((row) => row.key === "Credit spreads (puts)");
    const calls = insights.strategies.find((row) => row.key === "Credit spreads (calls)");
    expect(puts?.sample).toBe("enough");
    expect(puts && puts.netPnl).toBeGreaterThan(0);
    expect(calls?.sample).toBe("short");
    expect(insights.byStrategy["Credit spreads (puts)"]?.metrics.maxDrawdown).not.toBeNull();
    expect(insights.comparison.benchmarkStatus).toBe("ok");
    expect(insights.comparison.accountReturn).not.toBeNull();
    expect(insights.comparison.openPositions).toBe(1);
    expect(insights.account?.perspective ?? "").not.toMatch(/win rate|\bwins\b|W\/L|streak/i);
    expect(empty.emptyMessage).toBe(EMPTY_CLOSED);
    expect(empty.headline).toBeNull();
    expect(empty.comparison.benchmarkStatus).toBe("unavailable");
    expect(empty.comparison.footnote.toLowerCase()).toContain("benchmark unavailable");
  });
});

describe("journal source guard", () => {
  it("does not mention a manual result flag, a win rate, or a broker name", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const banned = /resultLoggedAt|trade_journal|winRate|win rate|schwab|alpaca|thinkorswim|tdameritrade|tastytrade/i;
    for (const name of files) {
      const text = readFileSync(join(dir, name), "utf8");
      expect(text, name).not.toMatch(banned);
    }
  });
});
