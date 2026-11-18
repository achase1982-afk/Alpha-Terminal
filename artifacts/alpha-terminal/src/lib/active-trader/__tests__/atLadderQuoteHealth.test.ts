import { describe, expect, it } from "vitest";
import { resolveChainDisplayQuote } from "@/lib/chainContractQuoteMerge";
import { auditNearAtmLadderQuotes } from "../atLadderQuoteHealth";

const baseContract = (strike: number) => ({
  strike,
  expiration: "2026-11-21",
  streamKey: `AAPL  251121C00${strike}`,
  bid: 1.1,
  ask: 1.2,
});

describe("auditNearAtmLadderQuotes", () => {
  const now = Date.now();

  it("flags crossed near-ATM legs", () => {
    const contract = { ...baseContract(350), bid: 2, ask: 1 };
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
      rows: [{ strike: 355, call: { ...baseContract(355), bid: undefined, ask: undefined }, put: null }],
      underlyingPrice: 355,
      ticks: {},
      chainQuoteTs: now,
      nowMs: now,
    });
    expect(audit.counts.incomplete).toBeGreaterThan(0);
    expect(audit.nearAtm[0]?.reason).toBe("No quote");
  });

  it("flags stale chain timestamps", () => {
    const audit = auditNearAtmLadderQuotes({
      rows: [{ strike: 352.5, call: baseContract(352.5), put: null }],
      underlyingPrice: 352.5,
      ticks: {},
      chainQuoteTs: now - 60_000,
      nowMs: now,
    });
    expect(audit.counts.stale).toBe(1);
    expect(audit.nearAtm[0]?.reason).toBe("Stale");
  });
});