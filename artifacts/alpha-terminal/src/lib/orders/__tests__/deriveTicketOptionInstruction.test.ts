import { describe, expect, it } from "vitest";
import { deriveTicketOptionInstruction } from "../deriveTicketOptionInstruction";

describe("deriveTicketOptionInstruction", () => {
  it("maps open legs from side", () => {
    expect(deriveTicketOptionInstruction({ side: "BUY" })).toBe("BUY_TO_OPEN");
    expect(deriveTicketOptionInstruction({ side: "SELL" })).toBe("SELL_TO_OPEN");
  });

  it("respects isCloseOrder and posEffect", () => {
    expect(deriveTicketOptionInstruction({ side: "BUY", isCloseOrder: true })).toBe("BUY_TO_CLOSE");
    expect(deriveTicketOptionInstruction({ side: "SELL", posEffect: "CLOSING" })).toBe("SELL_TO_CLOSE");
    expect(deriveTicketOptionInstruction({ side: "SELL", posEffect: "OPENING" })).toBe("SELL_TO_OPEN");
  });
});