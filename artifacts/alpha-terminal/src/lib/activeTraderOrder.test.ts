import { describe, expect, it } from "vitest";
import {
  Dec,
  brokerQuantity,
  cashAmount,
  packageQuotes,
  percentageExitRaw,
  roundExit,
  stepSpxSingle,
  strategyName,
  type PackageLeg,
} from "./activeTraderOrder";

describe("active trader order math", () => {
  it("prices a long call the way the mockup specifies", () => {
    const quotes = packageQuotes([
      { ratio: 1, side: 1, bid: "1.05", ask: "1.50", right: "CALL", strike: "7415", expiration: "2026-11-20" },
    ]);
    if ("error" in quotes) throw new Error(quotes.error);
    expect(quotes.kind).toBe("DEBIT");
    expect(quotes.displayMid.toFixed(3)).toBe("1.275");
    expect(cashAmount(1, "100", Dec.must("1.50")).toFixed(2)).toBe("150.00");
    const tp = percentageExitRaw(Dec.must("1.50"), "DEBIT", "tp", Dec.must("25"));
    const sl = percentageExitRaw(Dec.must("1.50"), "DEBIT", "sl", Dec.must("15"));
    if ("error" in tp || "error" in sl) throw new Error("exit");
    expect(roundExit(tp.premium, "DEBIT", "tp", Dec.must("1.50"), "spx-single")).toMatchObject({
      premium: expect.objectContaining({}),
    });
    const tpSnap = roundExit(tp.premium, "DEBIT", "tp", Dec.must("1.50"), "spx-single");
    const slSnap = roundExit(sl.premium, "DEBIT", "sl", Dec.must("1.50"), "spx-single");
    if ("error" in tpSnap || "error" in slSnap) throw new Error("snap");
    expect(tpSnap.premium.toFixed(2)).toBe("1.90");
    expect(slSnap.premium.toFixed(2)).toBe("1.30");
    expect(cashAmount(1, "100", tpSnap.premium.sub(Dec.must("1.50"))).toFixed(2)).toBe("40.00");
    expect(cashAmount(1, "100", Dec.must("1.50").sub(slSnap.premium)).toFixed(2)).toBe("20.00");
  });

  it("prices a bull put spread from signed quotes, not the picture's mid", () => {
    const legs: PackageLeg[] = [
      { ratio: 1, side: -1, bid: "0.25", ask: "3.40", right: "PUT", strike: "7415", expiration: "2026-11-20" },
      { ratio: 1, side: 1, bid: "0.00", ask: "0.05", right: "PUT", strike: "7410", expiration: "2026-11-20" },
    ];
    const quotes = packageQuotes(legs);
    if ("error" in quotes) throw new Error(quotes.error);
    expect(quotes.signedBid.toFixed(2)).toBe("-3.40");
    expect(quotes.signedMid.toFixed(2)).toBe("-1.80");
    expect(quotes.signedAsk.toFixed(2)).toBe("-0.20");
    expect(quotes.kind).toBe("CREDIT");
    expect(quotes.displayBid.toFixed(2)).toBe("0.20");
    expect(quotes.displayMid.toFixed(2)).toBe("1.80");
    expect(quotes.displayAsk.toFixed(2)).toBe("3.40");
    expect(strategyName(legs)).toBe("Bull Put Spread");
    expect(cashAmount(1, "100", Dec.must("0.20")).toFixed(2)).toBe("20.00");
    const tp = percentageExitRaw(Dec.must("0.20"), "CREDIT", "tp", Dec.must("50"));
    if ("error" in tp) throw new Error(tp.error);
    const snapped = roundExit(tp.premium, "CREDIT", "tp", Dec.must("0.20"), "spx-complex");
    if ("error" in snapped) throw new Error(snapped.error);
    expect(snapped.premium.toFixed(2)).toBe("0.10");
  });

  it("snaps a 50% short SPXW target once, to 1.55", () => {
    const raw = percentageExitRaw(Dec.must("3.10"), "CREDIT", "tp", Dec.must("50"));
    if ("error" in raw) throw new Error(raw.error);
    expect(raw.premium.toFixed(2)).toBe("1.55");
    const snapped = roundExit(raw.premium, "CREDIT", "tp", Dec.must("3.10"), "spx-single");
    if ("error" in snapped) throw new Error(snapped.error);
    expect(snapped.premium.toFixed(2)).toBe("1.55");
  });

  it("steps the SPX single grid across 3.00", () => {
    expect(stepSpxSingle(Dec.must("3.00"), -1).toFixed(2)).toBe("2.95");
    expect(stepSpxSingle(Dec.must("2.95"), 1).toFixed(2)).toBe("3.00");
    expect(stepSpxSingle(Dec.must("3.00"), 1).toFixed(2)).toBe("3.10");
    expect(stepSpxSingle(Dec.must("3.10"), -1).toFixed(2)).toBe("3.00");
  });

  it("multiplies package quantity by the leg ratio and not by 100", () => {
    expect(brokerQuantity(4, 1)).toBe(4);
    expect(brokerQuantity(2, 2)).toBe(4);
  });

  it("rejects a quote that is missing or crossed", () => {
    const bad = packageQuotes([
      { ratio: 1, side: 1, bid: "1.50", ask: "1.05", right: "CALL", strike: "100", expiration: "2026-11-20" },
    ]);
    expect(bad).toEqual({ error: "quote" });
  });
});
