import { describe, expect, it } from "vitest";
import { mergeLegStreamQuotes, selectTicketExecutablePrices } from "../ticketQuotes.js";

describe("ticketQuotes G1-1", () => {
  const underlying = { bid: 599.5, ask: 599.7, last: 599.6 };
  const optionTick = { bid: 3.7, ask: 3.8, last: 3.75, ts: Date.now() };

  it("single option ticket prices come from option tick, not underlying", () => {
    const exec = selectTicketExecutablePrices({
      mode: "single_option",
      underlyingQuote: underlying,
      optionTick,
    });
    expect(exec.bid).toBe(3.7);
    expect(exec.ask).toBe(3.8);
    expect(exec.bid).not.toBe(underlying.bid);
    expect(exec.ask).not.toBe(underlying.ask);
  });

  it("stock ticket uses underlying stream quote", () => {
    const exec = selectTicketExecutablePrices({
      mode: "stock",
      underlyingQuote: underlying,
      optionTick,
    });
    expect(exec.bid).toBe(599.5);
    expect(exec.ask).toBe(599.7);
  });

  it("multi-leg display quotes refresh from stream ticks, not stale REST", () => {
    const leg = {
      schwabSymbol: "SPY  251219C00600000",
      bid: 599.5,
      ask: 599.7,
      instruction: "BUY_TO_OPEN",
    };
    const merged = mergeLegStreamQuotes(leg, optionTick);
    expect(merged.bid).toBe(3.7);
    expect(merged.ask).toBe(3.8);
    expect(merged.bid).not.toBe(leg.bid);
  });
});