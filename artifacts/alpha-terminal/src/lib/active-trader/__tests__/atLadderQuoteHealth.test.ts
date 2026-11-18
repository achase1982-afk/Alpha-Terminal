import { describe, expect, it } from "vitest";
import { resolveChainDisplayQuote } from "@/lib/chainContractQuoteMerge";
import { auditNearAtmLadderQuotes } from "../atLadderQuoteHealth";
import { equityOptionsGthOpenMs } from "@workspace/order-ticket-math";

const baseContract = (strike: number, quoteTimeMs: number) => ({
  strike,
  expiration: "2026-11-21",
  streamKey: `AAPL  251121C00${strike}`,
  bid: 1.1,
  ask: 1.2,
  quoteTimeMs,
});

describe("auditNearAtmLadderQuotes", () => {
  const now = equityOptionsGthOpenMs(Date.now()) + 60 * 60_000;
  const prior = now - 20 * 3_600_000;

  it("flags crossed near-ATM legs", () => {
    const contract = { ...baseContract(350, now), bid: 2, ask: 1 };
    expect(resolveChainDisplayQuote(contract, null, now, now).displayState).toBe("crossed");
    const audit = auditNearAtmLadderQuotes({
      rows: [{ strike: 350, call: contract, put: null }],
      underlyingPrice: 350,
      ticks: {},
      chainQuoteTs: now,
      nowMs: now,
    });
    expect(audit.nearAtmHasInvalid).toBe(true);
    expect(audit.nearAtm[0]?.reason).toBe("Crossed");
  });

  it("flags missing quotes", () => {
    const audit = auditNearAtmLadderQuotes({
      rows: [{ strike: 355, call: { ...baseContract(355, now), bid: undefined, ask: undefined }, put: null }],
      underlyingPrice: 355,
      ticks: {},
      chainQuoteTs: now,
      nowMs: now,
    });
    expect(audit.counts.incomplete).toBeGreaterThan(0);
    expect(audit.nearAtm[0]?.reason).toBe("No quote");
  });

  it("does not treat prior-session carryover as invalid", () => {
    const audit = auditNearAtmLadderQuotes({
      rows: [{ strike: 352.5, call: baseContract(352.5, prior), put: null }],
      underlyingPrice: 352.5,
      ticks: {},
      chainQuoteTs: now,
      nowMs: now,
    });
    expect(audit.nearAtmHasInvalid).toBe(false);
    expect(resolveChainDisplayQuote(baseContract(350, prior), null, now, now).displayState).toBe("prior_session");
  });

  it("accepts locked quotes", () => {
    expect(
      resolveChainDisplayQuote({ bid: 0.54, ask: 0.54, quoteTimeMs: prior }, null, Date.now(), now).displayState,
    ).toBe("prior_session");
  });
});