import { rebuildBook } from "./ledger.js";
import { buildInsights, type BenchmarkPoint, type EquityPoint } from "./metrics.js";
import type { InsightsPayload, NormalizedActivity, NormalizedLeg } from "./types.js";

const ACCOUNT = "example-book";
const AS_OF = "2026-11-18T21:00:00.000Z";

function leg(over: Partial<NormalizedLeg> & Pick<NormalizedLeg, "instrumentKey" | "quantityDelta" | "price">): NormalizedLeg {
  return {
    assetClass: "equity",
    underlying: "AAPL",
    putCall: null,
    strike: null,
    expiration: null,
    multiplier: 1,
    fees: 0,
    effect: "open",
    ...over,
  };
}

function optionLeg(input: {
  underlying: string;
  expiration: string;
  right: "P" | "C";
  strike: number;
  delta: number;
  price: number;
  effect: "open" | "close";
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
    effect: input.effect,
  });
}

function at(dayIndex: number, hourUtc: number, minute: number): string {
  return new Date(Date.UTC(2026, 2, 2 + dayIndex, hourUtc, minute, 0)).toISOString();
}

function vertical(input: {
  id: string;
  day: number;
  underlying: string;
  expiration: string;
  right: "P" | "C";
  shortStrike: number;
  longStrike: number;
  openShort: number;
  closeShort: number;
  openLong: number;
  closeLong: number;
  openHour: number;
  closeHour: number;
  closeDay?: number;
  closeMinute?: number;
}): NormalizedActivity[] {
  const openedAt = at(input.day, input.openHour, 0);
  const closedAt = at(input.closeDay ?? input.day, input.closeHour, input.closeMinute ?? 0);
  const shared = {
    underlying: input.underlying,
    expiration: input.expiration,
  };
  return [
    {
      id: `${input.id}-o`,
      accountRef: ACCOUNT,
      occurredAt: openedAt,
      kind: "trade",
      netAmount: 0,
      fees: 1,
      orderRef: input.id,
      description: "",
      legs: [
        optionLeg({ ...shared, right: input.right, strike: input.shortStrike, delta: -1, price: input.openShort, effect: "open", fees: 0.5 }),
        optionLeg({ ...shared, right: input.right, strike: input.longStrike, delta: 1, price: input.openLong, effect: "open", fees: 0.5 }),
      ],
    },
    {
      id: `${input.id}-c`,
      accountRef: ACCOUNT,
      occurredAt: closedAt,
      kind: "trade",
      netAmount: 0,
      fees: 0,
      orderRef: null,
      description: "",
      legs: [
        optionLeg({ ...shared, right: input.right, strike: input.shortStrike, delta: 1, price: input.closeShort, effect: "close" }),
        optionLeg({ ...shared, right: input.right, strike: input.longStrike, delta: -1, price: input.closeLong, effect: "close" }),
      ],
    },
  ];
}

function exampleActivities(): NormalizedActivity[] {
  const activities: NormalizedActivity[] = [];
  for (let i = 0; i < 32; i += 1) {
    const overnight = i % 7 === 0;
    const afternoon = !overnight && i % 3 === 2;
    const quick = !overnight && !afternoon && i % 3 === 0;
    activities.push(...vertical({
      id: `cp${i}`,
      day: i,
      underlying: "SPXW",
      expiration: "2026-11-20",
      right: "P",
      shortStrike: 7300 + i,
      longStrike: 7250 + i,
      openShort: 2,
      closeShort: 1.5,
      openLong: 1,
      closeLong: 1,
      openHour: afternoon ? 20 : 15,
      closeHour: overnight ? 15 : quick ? 15 : afternoon ? 21 : 17,
      closeDay: overnight ? i + 1 : i,
      closeMinute: quick ? 20 : 0,
    }));
  }
  for (let i = 0; i < 32; i += 1) {
    activities.push(...vertical({
      id: `db${i}`,
      day: i,
      underlying: "QQQ",
      expiration: "2026-09-18",
      right: "P",
      shortStrike: 400 + i,
      longStrike: 410 + i,
      openShort: 1,
      closeShort: 1,
      openLong: 4,
      closeLong: 2,
      openHour: 15,
      closeHour: 18,
    }));
  }
  for (let i = 0; i < 12; i += 1) {
    activities.push(...vertical({
      id: `cc${i}`,
      day: 40 + i,
      underlying: "SPXW",
      expiration: "2026-12-18",
      right: "C",
      shortStrike: 7600 + i,
      longStrike: 7650 + i,
      openShort: 2,
      closeShort: 2.31,
      openLong: 1,
      closeLong: 1,
      openHour: 20,
      closeHour: 21,
    }));
  }
  for (let i = 0; i < 8; i += 1) {
    const expiration = "2026-10-16";
    const openedAt = at(50 + i, 15, 5);
    const closedAt = at(50 + i, 18, 5);
    const putShort = 7200 + i;
    const putLong = 7150 + i;
    const callShort = 7500 + i;
    const callLong = 7550 + i;
    activities.push(
      {
        id: `ic${i}-o`,
        accountRef: ACCOUNT,
        occurredAt: openedAt,
        kind: "trade",
        netAmount: 0,
        fees: 1,
        orderRef: `ic${i}`,
        description: "",
        legs: [
          optionLeg({ underlying: "SPX", expiration, right: "P", strike: putShort, delta: -1, price: 2, effect: "open", fees: 0.25 }),
          optionLeg({ underlying: "SPX", expiration, right: "P", strike: putLong, delta: 1, price: 1, effect: "open", fees: 0.25 }),
          optionLeg({ underlying: "SPX", expiration, right: "C", strike: callShort, delta: -1, price: 1.5, effect: "open", fees: 0.25 }),
          optionLeg({ underlying: "SPX", expiration, right: "C", strike: callLong, delta: 1, price: 0.8, effect: "open", fees: 0.25 }),
        ],
      },
      {
        id: `ic${i}-c`,
        accountRef: ACCOUNT,
        occurredAt: closedAt,
        kind: "trade",
        netAmount: 0,
        fees: 0,
        orderRef: null,
        description: "",
        legs: [
          optionLeg({ underlying: "SPX", expiration, right: "P", strike: putShort, delta: 1, price: 1.8, effect: "close" }),
          optionLeg({ underlying: "SPX", expiration, right: "P", strike: putLong, delta: -1, price: 1, effect: "close" }),
          optionLeg({ underlying: "SPX", expiration, right: "C", strike: callShort, delta: 1, price: 1.4, effect: "close" }),
          optionLeg({ underlying: "SPX", expiration, right: "C", strike: callLong, delta: -1, price: 0.9, effect: "close" }),
        ],
      },
    );
  }
  for (let i = 0; i < 32; i += 1) {
    activities.push(
      {
        id: `eq${i}-o`,
        accountRef: ACCOUNT,
        occurredAt: at(70 + i, 15, 0),
        kind: "trade",
        netAmount: 0,
        fees: 1,
        orderRef: `eq${i}`,
        description: "",
        legs: [leg({ instrumentKey: "AAPL", underlying: "AAPL", quantityDelta: 10, price: 100, fees: 1, effect: "open" })],
      },
      {
        id: `eq${i}-c`,
        accountRef: ACCOUNT,
        occurredAt: at(70 + i, 16, 20),
        kind: "trade",
        netAmount: 0,
        fees: 0,
        orderRef: null,
        description: "",
        legs: [leg({ instrumentKey: "AAPL", underlying: "AAPL", quantityDelta: -10, price: 104.1, effect: "close" })],
      },
    );
  }
  activities.push({
    id: "spy-open",
    accountRef: ACCOUNT,
    occurredAt: "2026-11-18T15:00:00.000Z",
    kind: "trade",
    netAmount: 0,
    fees: 0,
    orderRef: "spy-open",
    description: "",
    legs: [leg({ instrumentKey: "SPY", underlying: "SPY", quantityDelta: 10, price: 500, effect: "open" })],
  });
  return activities;
}

const SNAPSHOTS: EquityPoint[] = [
  { at: "2026-01-02T21:00:00.000Z", value: 100_000 },
  { at: "2026-11-18T21:00:00.000Z", value: 96_200 },
];

const BENCHMARK: BenchmarkPoint[] = [
  { date: "2026-01-02", adjustedClose: 500 },
  { date: "2026-11-18", adjustedClose: 571 },
];

export function buildJournalFixtures(): { insights: InsightsPayload; empty: InsightsPayload } {
  const activities = exampleActivities();
  const { positions } = rebuildBook({ activities, marks: { SPY: 505 } });
  return {
    insights: buildInsights({
      positions,
      activities,
      period: "ytd",
      asOf: AS_OF,
      snapshots: SNAPSHOTS,
      benchmark: BENCHMARK,
    }),
    empty: buildInsights({
      positions: [],
      activities: [],
      period: "ytd",
      asOf: AS_OF,
      snapshots: [],
      benchmark: [],
    }),
  };
}
