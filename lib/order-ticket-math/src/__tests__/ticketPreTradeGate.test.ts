import { describe, expect, it } from "vitest";
import { evaluateTicketPreTradeGate, serverShouldRejectOrder } from "../ticketPreTradeGate.js";

describe("ticketPreTradeGate", () => {
  const redChecks = [
    { id: "dte", level: "RED" as const },
    { id: "liq", level: "YELLOW" as const },
  ];

  it("blocks when blockOnRed and any RED", () => {
    const r = evaluateTicketPreTradeGate({ blockOnRed: true, checks: redChecks });
    expect(r.shouldBlockSubmit).toBe(true);
    expect(r.blockingCheckIds).toEqual(["dte"]);
  });

  it("does not block when blockOnRed is false (advisory only)", () => {
    const r = evaluateTicketPreTradeGate({ blockOnRed: false, checks: redChecks });
    expect(r.shouldBlockSubmit).toBe(false);
    expect(r.advisoryFailIds).toEqual(["dte"]);
  });

  it("server rejects matching client payload", () => {
    expect(
      serverShouldRejectOrder({
        blockOnRed: true,
        overall: "RED",
        checks: redChecks,
      }),
    ).toBe(true);
  });
});