import { describe, expect, it } from "vitest";
import { evaluateTicketPreTradeGate, serverShouldRejectOrder } from "../ticketPreTradeGate.js";

describe("ticketPreTradeGate", () => {
  const redChecks = [
    { id: "dte", level: "RED" as const },
    { id: "liq", level: "YELLOW" as const },
  ];

  it("always blocks FAIL even when blockOnRed is false", () => {
    const r = evaluateTicketPreTradeGate({ blockOnRed: false, checks: redChecks });
    expect(r.shouldBlockSubmit).toBe(true);
    expect(r.shouldBlockReview).toBe(true);
    expect(r.blockingCheckIds).toEqual(["dte"]);
  });

  it("blocks WARN only when blockOnRed", () => {
    const r = evaluateTicketPreTradeGate({
      blockOnRed: true,
      checks: [{ id: "rr", level: "YELLOW" }],
    });
    expect(r.shouldBlockSubmit).toBe(true);
  });

  it("server rejects missing gate", () => {
    expect(serverShouldRejectOrder(null)).toBe(false);
    expect(serverShouldRejectOrder(undefined)).toBe(false);
  });

  it("server allows disabled gate", () => {
    expect(
      serverShouldRejectOrder({
        enabled: false,
        blockOnRed: true,
        overall: "RED",
        checks: redChecks,
      }),
    ).toBe(false);
  });

  it("server rejects matching FAIL payload", () => {
    expect(
      serverShouldRejectOrder({
        enabled: true,
        blockOnRed: false,
        overall: "RED",
        checks: redChecks,
      }),
    ).toBe(true);
  });
});