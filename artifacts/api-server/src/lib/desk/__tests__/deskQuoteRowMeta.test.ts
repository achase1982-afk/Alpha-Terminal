import { describe, expect, it } from "vitest";
import {
  annotateDeskQuoteRow,
  deskQuoteRowEventMs,
  deskTwoSidedQuoteValid,
} from "../deskQuoteRowMeta.js";

describe("deskQuoteRowMeta", () => {
  it("flags one-sided alpaca paper quote invalid", () => {
    expect(deskTwoSidedQuoteValid(335.01, 0)).toBe(false);
    const row = annotateDeskQuoteRow(
      { symbol: "AAPL", bid: 335.01, ask: 0, t: "2026-11-17T16:00:00.000Z" },
      "alpaca_paper",
      Date.parse("2026-11-18T10:00:00.000Z"),
    );
    expect(row.quote_invalid).toBe(true);
    expect(row.stale).toBe(true);
  });

  it("uses quote_ts not fetch time for staleness", () => {
    const ts = Date.parse("2026-11-18T10:00:00.000Z");
    const row = annotateDeskQuoteRow(
      { symbol: "AAPL", bid: 350, ask: 350.2, quote_ts: ts },
      "schwab_quotes_rest",
      ts + 2_000,
    );
    expect(deskQuoteRowEventMs(row)).toBe(ts);
    expect(row.stale).toBe(false);
    expect(row.quote_invalid).toBe(false);
  });
});