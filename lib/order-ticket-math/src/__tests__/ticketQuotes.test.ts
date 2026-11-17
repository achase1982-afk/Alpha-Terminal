import { describe, expect, it } from "vitest";
import { mergeLegStreamQuotes, selectTicketExecutablePrices } from "../ticketQuotes.js";

describe("ticketQuotes", () => {
  it("mergeLegStreamQuotes prefers stream when newer than contractTs", () => {
    const leg = { schwabSymbol: "AAPL", bid: 1.0, ask: 1.1, contractTs: 1000, delta: null };
    const merged = mergeLegStreamQuotes(leg, { bid: 2.5, ask: 2.7, ts: 2000 });
    expect(merged.bid).toBe(2.5);
    expect(merged.ask).toBe(2.7);
  });

  it("mergeLegStreamQuotes falls back to stored pair when stream missing", () => {
    const leg = { schwabSymbol: "AAPL", bid: 1.0, ask: 1.1, delta: null };
    const merged = mergeLegStreamQuotes(leg, null);
    expect(merged.bid).toBe(1.0);
    expect(merged.ask).toBe(1.1);
  });

  it("selectTicketExecutablePrices uses option tick for single_option", () => {
    const q = selectTicketExecutablePrices({
      mode: "single_option",
      underlyingQuote: { bid: 100, ask: 101, last: 100.5 },
      optionTick: { bid: 2.5, ask: 2.7, last: 2.6, ts: 1 },
    });
    expect(q.bid).toBe(2.5);
    expect(q.ask).toBe(2.7);
  });
});
