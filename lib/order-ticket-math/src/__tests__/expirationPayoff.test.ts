import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeOrderEconomics } from "../orderEconomics.js";
import {
  analyzeExpirationPayoff,
  payoffDollarsAtS,
  type ExpirationPayoffInput,
  type PayoffLeg,
} from "../expirationPayoff.js";
import { schwabOrderMaxRisk } from "../schwabOrderRisk.js";
import { evaluateServerPlaceOrderGate } from "../serverPlaceOrderGate.js";

const __dir = path.dirname(fileURLToPath(import.meta.url));

function rightTailSlopePerShare(legs: PayoffLeg[]): number {
  let slope = 0;
  for (const leg of legs) {
    if (leg.optionType === "CALL") {
      const q = leg.quantity ?? 1;
      slope += leg.instruction.startsWith("BUY") ? q : -q;
    }
  }
  return slope;
}

/** Dense scan + tail slope — reference brute-force max P/L (test-only). */
function referenceBruteForcePayoff(input: ExpirationPayoffInput): {
  maxLoss: number | null;
  maxProfit: number;
} {
  const strikes = input.legs
    .filter((l) => l.optionType === "CALL" || l.optionType === "PUT")
    .map((l) => l.strike);
  const hi = strikes.length ? Math.max(...strikes) + 25 : 50;
  let minP = Infinity;
  let maxP = -Infinity;
  for (let s = 0; s <= hi; s += 0.25) {
    const p = payoffDollarsAtS(input, s);
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;
  }
  const unitRight = rightTailSlopePerShare(input.legs);
  const dollarRight = unitRight * 100 * input.spreadUnits;
  const unboundedLoss = dollarRight < 0;
  const maxLoss = unboundedLoss ? null : Math.max(0, -minP);
  const maxProfit = dollarRight > 0 ? Number.POSITIVE_INFINITY : Math.max(0, maxP);
  return { maxLoss, maxProfit };
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const spx = { underlyingSymbol: "SPX", isOption: true as const };
const sym = (cp: "C" | "P", strike: number) =>
  `SPXW  261118${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`;

function putVertical(shortStrike: number, longStrike: number, credit: boolean, net: number) {
  return computeOrderEconomics({
    ...spx,
    legs: credit
      ? [
          { strike: shortStrike, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1 },
          { strike: longStrike, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
        ]
      : [
          { strike: shortStrike, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
          { strike: longStrike, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1 },
        ],
    limitPrice: net,
    quantity: 1,
    isCredit: credit,
  });
}

function callVertical(buyStrike: number, sellStrike: number, debit: boolean, net: number) {
  return computeOrderEconomics({
    ...spx,
    legs: debit
      ? [
          { strike: buyStrike, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
          { strike: sellStrike, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1 },
        ]
      : [
          { strike: buyStrike, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1 },
          { strike: sellStrike, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        ],
    limitPrice: net,
    quantity: 1,
    isCredit: !debit,
  });
}

describe("expiration payoff engine", () => {
  it("5-wide put credit at 1.00: maxLoss 400, maxProfit 100", () => {
    const e = putVertical(5895, 5890, true, 1);
    expect(e?.maxRisk).toBe(400);
    expect(e?.maxProfit).toBe(100);
  });

  it("SPX 5900/5890 put credit at 2.55: maxProfit 255", () => {
    const e = putVertical(5900, 5890, true, 2.55);
    expect(e?.maxProfit).toBe(255);
  });

  it("bull call 5900/5910 at 2.55: BE 5902.55", () => {
    const e = callVertical(5900, 5910, true, 2.55);
    expect(e?.breakevens[0]).toBeCloseTo(5902.55, 5);
  });

  it("bear put 5910/5900 at 2.55: BE 5907.45", () => {
    const e = putVertical(5910, 5900, true, 2.55);
    expect(e?.breakevens[0]).toBeCloseTo(5907.45, 5);
  });

  it("call fly 500/510x2/515 debit 1: maxLoss 100", () => {
    const e = computeOrderEconomics({
      ...spx,
      legs: [
        { strike: 500, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 510, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 2 },
        { strike: 515, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
      ],
      limitPrice: 1,
      quantity: 1,
      isCredit: false,
    });
    expect(e?.maxRisk).toBe(100);
  });

  it("debit vertical LIMIT 1.00 5-wide: maxLoss 100", () => {
    const e = callVertical(5900, 5905, true, 1);
    expect(e?.maxRisk).toBe(100);
  });

  it("ITM credit 4.00 5-wide: maxLoss 100", () => {
    const e = callVertical(5900, 5905, false, 4);
    expect(e?.maxRisk).toBe(100);
  });

  it("long strangle as LIMIT: the debit paid", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 3,
      orderLegCollection: [
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5950) } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 5850) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(300);
  });

  it("short put + long call credit 0.50: unknown, not RED", () => {
    const order = {
      orderType: "NET_CREDIT",
      price: 0.5,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 5900) } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5950) } },
      ],
    };
    expect(schwabOrderMaxRisk(order).kind).toBe("unknown");
    const gate = evaluateServerPlaceOrderGate({ order, accountEquity: 30_000 });
    expect(gate.checks.find((c: { id: string }) => c.id === "size")?.level).not.toBe("RED");
  });

  it("long call + 2 short calls: unbounded max loss", () => {
    const e = analyzeExpirationPayoff({
      legs: [
        { strike: 100, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 105, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 2 },
      ],
      netPerShare: 1,
      spreadUnits: 1,
      isCredit: false,
      isOption: true,
    });
    expect(e.maxLoss).toBeNull();
  });

  it("two long calls: unbounded max profit", () => {
    const e = analyzeExpirationPayoff({
      legs: [
        { strike: 100, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 105, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
      ],
      netPerShare: 2,
      spreadUnits: 1,
      isCredit: false,
      isOption: true,
    });
    expect(e.maxProfit).toBe(Number.POSITIVE_INFINITY);
  });

  it("expirationPayoff.ts has no structure-specific max-loss detectors", () => {
    const src = readFileSync(path.join(__dir, "../expirationPayoff.ts"), "utf8");
    expect(src).not.toMatch(/isSymmetric|IronCondor|oneTwoOne|BWB|Condor|ironFly/i);
    expect(src).not.toMatch(/wingPerShare|premiumDollars/);
  });

  it("analyzeExpirationPayoff matches dense brute-force on random multi-leg structures", () => {
    const rand = mulberry32(0x644_f00d);
    const strikes = [480, 485, 490, 495, 500, 505, 5900, 5905, 5910, 5950, 5955];
    for (let trial = 0; trial < 120; trial++) {
      const nLegs = 2 + Math.floor(rand() * 3);
      const legs: PayoffLeg[] = [];
      const used = new Set<number>();
      for (let i = 0; i < nLegs; i++) {
        let k = strikes[Math.floor(rand() * strikes.length)];
        while (used.has(k) && used.size < strikes.length) {
          k = strikes[Math.floor(rand() * strikes.length)];
        }
        used.add(k);
        legs.push({
          strike: k,
          optionType: rand() < 0.5 ? "PUT" : "CALL",
          instruction: rand() < 0.5 ? "BUY_TO_OPEN" : "SELL_TO_OPEN",
          quantity: 1 + Math.floor(rand() * 2),
        });
      }
      const spreadUnits = 1 + Math.floor(rand() * 3);
      const netPerShare = 0.5 + rand() * 4;
      const isCredit = rand() < 0.5;
      const input: ExpirationPayoffInput = {
        legs,
        netPerShare: Number(netPerShare.toFixed(2)),
        spreadUnits,
        isCredit,
        isOption: true,
      };
      const engine = analyzeExpirationPayoff(input);
      const ref = referenceBruteForcePayoff(input);
      if (ref.maxLoss == null) expect(engine.maxLoss).toBeNull();
      else expect(engine.maxLoss).toBeCloseTo(ref.maxLoss, 4);
      if (Number.isFinite(ref.maxProfit)) expect(engine.maxProfit).toBeCloseTo(ref.maxProfit, 4);
      else expect(engine.maxProfit).toBe(Number.POSITIVE_INFINITY);
    }
  });
});
