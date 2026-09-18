import { describe, expect, it } from "vitest";
import {
  classifyDirection,
  classifyFamily,
  evaluateConsensus,
  type ConsensusLeg,
  type ConsensusMemberInput,
} from "../strategistConsensus.js";

const EXP = "2026-10-16";
const leg = (type: "call" | "put", action: "buy" | "sell", strike: number, expiration = EXP): ConsensusLeg =>
  ({ type, action, strike, expiration });

describe("direction from structure, not from the strategy name", () => {
  it("reads single legs", () => {
    expect(classifyDirection([leg("call", "buy", 100)])).toBe("BULLISH");
    expect(classifyDirection([leg("put", "buy", 100)])).toBe("BEARISH");
    expect(classifyDirection([leg("call", "sell", 100)])).toBe("BEARISH");
    expect(classifyDirection([leg("put", "sell", 100)])).toBe("BULLISH");
  });

  it("separates a bull call spread from a bear call spread", () => {
    expect(classifyDirection([leg("call", "buy", 100), leg("call", "sell", 105)])).toBe("BULLISH");
    expect(classifyDirection([leg("call", "sell", 100), leg("call", "buy", 105)])).toBe("BEARISH");
  });

  it("separates a bull put spread from a bear put spread", () => {
    expect(classifyDirection([leg("put", "sell", 105), leg("put", "buy", 100)])).toBe("BULLISH");
    expect(classifyDirection([leg("put", "buy", 105), leg("put", "sell", 100)])).toBe("BEARISH");
  });

  it("calls two-sided structures neutral", () => {
    // Long straddle.
    expect(classifyDirection([leg("call", "buy", 100), leg("put", "buy", 100)])).toBe("NEUTRAL");
    // Iron condor: short put spread plus short call spread.
    expect(
      classifyDirection([
        leg("put", "buy", 90), leg("put", "sell", 95),
        leg("call", "sell", 105), leg("call", "buy", 110),
      ]),
    ).toBe("NEUTRAL");
  });
});

describe("family from leg shape", () => {
  it("names the common structures", () => {
    expect(classifyFamily([leg("call", "buy", 100)])).toBe("single");
    expect(classifyFamily([leg("call", "buy", 100), leg("call", "sell", 105)])).toBe("vertical");
    expect(classifyFamily([leg("call", "buy", 100), leg("put", "buy", 100)])).toBe("straddle");
    expect(classifyFamily([leg("call", "buy", 105), leg("put", "buy", 95)])).toBe("strangle");
    expect(classifyFamily([
      leg("put", "buy", 90), leg("put", "sell", 95),
      leg("call", "sell", 105), leg("call", "buy", 110),
    ])).toBe("iron");
  });

  it("distinguishes a calendar from a diagonal", () => {
    expect(classifyFamily([leg("call", "sell", 100), leg("call", "buy", 100, "2026-11-20")])).toBe("calendar");
    expect(classifyFamily([leg("call", "sell", 100), leg("call", "buy", 105, "2026-11-20")])).toBe("diagonal");
  });

  it("flags an unbalanced same-type structure as a ratio", () => {
    expect(classifyFamily([
      leg("call", "buy", 100),
      { ...leg("call", "sell", 105), quantity: 2 },
    ])).toBe("ratio");
  });

  it("names a same-type three-leg balanced structure a butterfly", () => {
    expect(classifyFamily([
      leg("call", "buy", 95),
      { ...leg("call", "sell", 100), quantity: 2 },
      leg("call", "buy", 105),
    ])).toBe("butterfly");
  });
});

describe("consensus verdict", () => {
  const bullVertical = (label: string, confidence: number): ConsensusMemberInput => ({
    label, confidence, strategy: "bull call spread",
    legs: [leg("call", "buy", 100), leg("call", "sell", 105)],
  });

  it("ships the most confident card at the group mean when all agree", () => {
    const v = evaluateConsensus([bullVertical("A", 60), bullVertical("B", 80), bullVertical("C", 70)]);
    expect(v.agreed).toBe(true);
    expect(v.direction).toBe("BULLISH");
    expect(v.family).toBe("vertical");
    expect(v.winnerIndex).toBe(1);
    expect(v.meanConfidence).toBe(70);
  });

  it("passes when members disagree on direction", () => {
    const bear: ConsensusMemberInput = {
      label: "B", confidence: 75, strategy: "bear put spread",
      legs: [leg("put", "buy", 105), leg("put", "sell", 100)],
    };
    const v = evaluateConsensus([bullVertical("A", 70), bear]);
    expect(v.agreed).toBe(false);
    expect(v.winnerIndex).toBe(-1);
    expect(v.note).toMatch(/disagreed on direction/i);
  });

  it("passes when members agree on direction but not on structure", () => {
    const bullSingle: ConsensusMemberInput = {
      label: "B", confidence: 70, strategy: "long call", legs: [leg("call", "buy", 100)],
    };
    const v = evaluateConsensus([bullVertical("A", 70), bullSingle]);
    expect(v.agreed).toBe(false);
    expect(v.direction).toBe("BULLISH");
    expect(v.family).toBeNull();
    expect(v.note).toMatch(/disagreed on structure/i);
  });

  it("does not let one optimist carry the confidence number", () => {
    const v = evaluateConsensus([bullVertical("A", 30), bullVertical("B", 90)]);
    expect(v.agreed).toBe(true);
    expect(v.meanConfidence).toBe(60);
  });

  it("ships a lone surviving member but says so", () => {
    const v = evaluateConsensus([bullVertical("A", 65)]);
    expect(v.agreed).toBe(true);
    expect(v.note).toMatch(/without cross-model agreement/i);
  });

  it("passes when every member failed", () => {
    const v = evaluateConsensus([]);
    expect(v.agreed).toBe(false);
    expect(v.winnerIndex).toBe(-1);
  });
});
