import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  and: () => null,
  desc: () => null,
  eq: () => null,
  gte: () => null,
  inArray: () => null,
  isNull: () => null,
  lte: () => null,
  sql: () => null,
  equityDailyTable: {},
  optionsChainDailyTable: {},
  strategistHistoryTable: {},
  strategistJobsTable: {},
  strategistOutcomesTable: {},
  strategistTelemetryTable: {},
}));
vi.mock("../tokenStore.js", () => ({ getBestAccessToken: () => null }));
vi.mock("../logger.js", () => ({ logger: { info() {}, warn() {}, error() {} } }));

import {
  buildScoreboardFromRows,
  classifyOutcome,
  confidenceBucket,
  extractScorableCard,
  formatTrackRecordBlock,
  intrinsicValue,
  structureValue,
  summarizeScored,
  type OutcomeLeg,
} from "../strategistOutcomeScoreboard.js";

const debitLegs: OutcomeLeg[] = [
  { type: "call", side: "buy", strike: 100, expiration: "2026-10-16", entryMid: 4.2 },
  { type: "call", side: "sell", strike: 105, expiration: "2026-10-16", entryMid: 2.1 },
];
const creditLegs: OutcomeLeg[] = [
  { type: "put", side: "sell", strike: 100, expiration: "2026-10-16", entryMid: 3.0 },
  { type: "put", side: "buy", strike: 95, expiration: "2026-10-16", entryMid: 1.8 },
];

describe("structure value and P&L convention", () => {
  it("prices a debit vertical as positive and a credit vertical as negative", () => {
    expect(structureValue(debitLegs, (l) => l.entryMid)).toBe(2.1);
    expect(structureValue(creditLegs, (l) => l.entryMid)).toBe(-1.2);
  });

  it("returns null when any leg is unpriced", () => {
    expect(structureValue(debitLegs, (l) => (l.side === "buy" ? 4 : null))).toBeNull();
  });

  it("settles a put credit spread at expiry: max loss below the long strike, full credit above the short", () => {
    const deepItm = structureValue(creditLegs, (l) => intrinsicValue(l, 90));
    const otm = structureValue(creditLegs, (l) => intrinsicValue(l, 110));
    expect(deepItm).toBe(-5); // owe the 5-wide spread
    expect(otm).toBe(0);
    // pnl = mark - entry
    expect(deepItm! - -1.2).toBeCloseTo(-3.8, 6);
    expect(otm! - -1.2).toBeCloseTo(1.2, 6);
  });

  it("classifies outcomes with a one-cent dead band", () => {
    expect(classifyOutcome(0.5)).toBe("WIN");
    expect(classifyOutcome(-0.5)).toBe("LOSS");
    expect(classifyOutcome(0.004)).toBe("FLAT");
  });
});

describe("extractScorableCard", () => {
  const baseCard = {
    status: "recommendation",
    recommendation: {
      strategyType: "bull_call_spread",
      direction: "BULLISH",
      confidence: 68,
      debit: 2.1,
      maxLoss: 2.1,
      maxProfit: 2.9,
      expiration: "2026-10-16",
      exitTargets: { timeStop: "2026-10-09", profitTarget: 3.5, stopLoss: 1.0 },
      legs: [
        { type: "call", side: "buy", strike: 100, expiration: "2026-10-16", mid: 4.2 },
        { type: "call", side: "sell", strike: 105, expiration: "2026-10-16", mid: 2.1 },
      ],
    },
  };

  it("uses the stated debit, the time stop as the due date, and detects solo mode", () => {
    const c = extractScorableCard(baseCard, "2026-09-18");
    expect(c).not.toBeNull();
    expect(c!.entryValue).toBe(2.1);
    expect(c!.family).toBe("debit");
    expect(c!.markDue).toBe("2026-10-09");
    expect(c!.timeStop).toBe("2026-10-09");
    expect(c!.maxRisk).toBe(2.1);
    expect(c!.mode).toBe("solo");
  });

  it("falls back to expiration when the time stop is missing or not in the future", () => {
    const noTs = { ...baseCard, recommendation: { ...baseCard.recommendation, exitTargets: { timeStop: "" } } };
    expect(extractScorableCard(noTs, "2026-09-18")!.markDue).toBe("2026-10-16");
    const pastTs = { ...baseCard, recommendation: { ...baseCard.recommendation, exitTargets: { timeStop: "2026-09-01" } } };
    expect(extractScorableCard(pastTs, "2026-09-18")!.markDue).toBe("2026-10-16");
  });

  it("uses the credit as a negative entry and treats 99999 max profit as unbounded", () => {
    const credit = {
      ...baseCard,
      recommendation: { ...baseCard.recommendation, debit: undefined, credit: 1.2, maxProfit: 99999, direction: "NEUTRAL" },
    };
    const c = extractScorableCard(credit, "2026-09-18")!;
    expect(c.entryValue).toBe(-1.2);
    expect(c.family).toBe("credit");
    expect(c.maxProfit).toBeNull();
  });

  it("prices from leg mids when neither debit nor credit is stated", () => {
    const rec = { ...baseCard.recommendation } as Record<string, unknown>;
    delete rec.debit;
    const c = extractScorableCard({ ...baseCard, recommendation: rec }, "2026-09-18")!;
    expect(c.entryValue).toBe(2.1);
  });

  it("returns null for blocks, passes, and unpriced cards", () => {
    expect(extractScorableCard({ status: "no_viable_setup" }, "2026-09-18")).toBeNull();
    const unpriced = {
      ...baseCard,
      recommendation: {
        ...baseCard.recommendation,
        debit: undefined,
        legs: baseCard.recommendation.legs.map((l) => ({ ...l, mid: undefined })),
      },
    };
    expect(extractScorableCard(unpriced, "2026-09-18")).toBeNull();
  });

  it("detects desk and conviction modes from the desk result", () => {
    const desk = { ...baseCard, status: "desk_recommendation", deskResult: { pm: { decision: "trade" } } };
    expect(extractScorableCard(desk, "2026-09-18")!.mode).toBe("desk");
    const conviction = { ...desk, deskResult: { family_hypotheses: [], pm: {} } };
    expect(extractScorableCard(conviction, "2026-09-18")!.mode).toBe("conviction");
  });
});

describe("aggregation", () => {
  const mk = (over: Partial<Record<string, unknown>>) =>
    ({
      id: 1,
      historyId: 1,
      jobId: "j",
      userId: "u",
      ticker: "AAPL",
      signalAt: new Date("2026-09-01T14:00:00Z"),
      mode: "solo",
      provider: "anthropic",
      modelName: "claude-opus-5",
      strategyType: "bull_call_spread",
      family: "debit",
      direction: "BULLISH",
      confidence: 70,
      legs: [],
      entryValue: 2,
      maxRisk: 2,
      maxProfit: 3,
      expiration: "2026-10-16",
      timeStop: null,
      markDue: "2026-10-16",
      status: "scored",
      markDate: "2026-10-16",
      markSource: "chain_daily",
      markValue: 3,
      underlyingAtMark: 104,
      pnlPerShare: 1,
      pnlPctOfRisk: 50,
      outcome: "WIN",
      scoredAt: new Date(),
      unscorableReason: null,
      attempts: 1,
      createdAt: new Date(),
      ...over,
    }) as never;

  it("computes hit rate, payoff ratio, and expectancy in % of risk", () => {
    const rows = [
      mk({ outcome: "WIN", pnlPctOfRisk: 60 }),
      mk({ outcome: "WIN", pnlPctOfRisk: 40 }),
      mk({ outcome: "LOSS", pnlPctOfRisk: -100, pnlPerShare: -2 }),
      mk({ outcome: "LOSS", pnlPctOfRisk: -50, pnlPerShare: -1 }),
    ];
    const s = summarizeScored(rows);
    expect(s.hitRate).toBe(50);
    expect(s.avgPnlPctOfRisk).toBe(-12.5);
    expect(s.payoffRatio).toBeCloseTo(50 / 75, 2);
    // 0.5*50 + 0.5*(-75) = -12.5
    expect(s.expectancyPctOfRisk).toBe(-12.5);
  });

  it("buckets by confidence in a fixed order and counts pending separately", () => {
    const rows = [
      mk({ confidence: 30 }),
      mk({ confidence: 45, outcome: "LOSS", pnlPctOfRisk: -100 }),
      mk({ confidence: 80 }),
      mk({ status: "pending", outcome: null, pnlPctOfRisk: null, pnlPerShare: null }),
    ];
    const b = buildScoreboardFromRows(rows, 90);
    expect(b.summary.scored).toBe(3);
    expect(b.summary.pending).toBe(1);
    expect(b.byConfidence.map((x) => x.key)).toEqual(["<40", "40-59", "75+"]);
    expect(confidenceBucket(59.9)).toBe("40-59");
    expect(confidenceBucket(null)).toBe("unknown");
  });

  it("withholds the prompt block until ten cards are scored", () => {
    const few = buildScoreboardFromRows([mk({}), mk({})], 90);
    expect(formatTrackRecordBlock(few)).toBeNull();
    const many = buildScoreboardFromRows(Array.from({ length: 12 }, (_, i) => mk({ id: i, confidence: 50 + i })), 90);
    const block = formatTrackRecordBlock(many)!;
    expect(block).toContain("12 scored");
    expect(block).toContain("hit rate 100%");
    expect(block).toContain("By stated confidence");
  });
});
