import { describe, expect, it } from "vitest";
import { isFuturesDisplaySymbol } from "../futuresSchwabUi";

describe("OrderTicket futures guard (futuresSchwabUi)", () => {
  it("treats slash and dotted-slash roots as order-blocked", () => {
    expect(isFuturesDisplaySymbol("/ES")).toBe(true);
    expect(isFuturesDisplaySymbol("./MESZ26")).toBe(true);
    expect(isFuturesDisplaySymbol("QQQ")).toBe(false);
  });
});