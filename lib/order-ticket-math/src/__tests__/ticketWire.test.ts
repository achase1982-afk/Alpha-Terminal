import { describe, expect, it } from "vitest";
import { evaluateTicketPreTradeGate } from "../ticketPreTradeGate.js";
import {
  displaySubmittedLimit,
  optionMidLimit,
  resolveSubmittedLimit,
  schwabPriceFromTicket,
  stockMidLimit,
  ticketAndReviewEconomics,
} from "../ticketWire.js";

describe("ticketWire", () => {
  const spyCtx = { underlyingSymbol: "SPY", isOption: true };
  const stockCtx = { underlyingSymbol: "AAPL", isOption: false };

  it("displayed limit equals submitted limit for options", () => {
    const limit = resolveSubmittedLimit(spyCtx, "2.036");
    const displayed = displaySubmittedLimit(spyCtx, limit);
    const submitted = schwabPriceFromTicket(spyCtx, displayed);
    expect(submitted).toBe(limit);
    expect(displayed).toBe("2.04");
  });

  it("stock Mid is not rounded", () => {
    const s = stockMidLimit(100.125, 100.375);
    expect(s).toBe("100.25");
    const parsed = resolveSubmittedLimit(stockCtx, s!);
    expect(parsed).toBeCloseTo(100.25, 6);
  });

  it("option Mid is tick-rounded", () => {
    const s = optionMidLimit(spyCtx, 2.01, 2.07);
    expect(s).toBe("2.04");
  });

  it("FAIL blocks Review and Send; WARN only when blockOnRed", () => {
    const fail = evaluateTicketPreTradeGate({
      blockOnRed: false,
      checks: [{ id: "dte", level: "RED" }],
    });
    expect(fail.shouldBlockSubmit).toBe(true);
    expect(fail.shouldBlockReview).toBe(true);

    const warnAdvisory = evaluateTicketPreTradeGate({
      blockOnRed: false,
      checks: [{ id: "rr", level: "YELLOW" }],
    });
    expect(warnAdvisory.shouldBlockSubmit).toBe(false);

    const warnBlocked = evaluateTicketPreTradeGate({
      blockOnRed: true,
      checks: [{ id: "rr", level: "YELLOW" }],
    });
    expect(warnBlocked.shouldBlockSubmit).toBe(true);
  });

  it("risk is identical for ticket and review economics", () => {
    const input = {
      underlyingSymbol: "SPX",
      isOption: true,
      isCredit: true,
      quantity: 2,
      limitPrice: "2.05",
      legs: [
        { strike: 5900, optionType: "PUT", instruction: "SELL_TO_OPEN" },
        { strike: 5850, optionType: "PUT", instruction: "BUY_TO_OPEN" },
      ],
    };
    const a = ticketAndReviewEconomics(input);
    const b = ticketAndReviewEconomics(input);
    expect(a?.maxRisk).toBe(b?.maxRisk);
    expect(a?.netPricePerShare).toBe(b?.netPricePerShare);
  });
});