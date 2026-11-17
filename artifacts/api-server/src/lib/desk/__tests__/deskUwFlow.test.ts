import { describe, expect, it } from "vitest";
import { deskFilterUwFlowAlerts, deskUwFlowTickerQuery } from "../deskUwFlow.js";

describe("deskUwFlow", () => {
  it("maps SPX to SPX,SPXW ticker query", () => {
    expect(deskUwFlowTickerQuery("SPX")).toBe("SPX,SPXW");
    expect(deskUwFlowTickerQuery("$SPX")).toBe("SPX,SPXW");
  });

  it("filters alerts by underlying", () => {
    const alerts = [
      { ticker: "AAPL" },
      { underlying_symbol: "SPX" },
      { ticker_symbol: "SPXW" },
    ];
    const out = deskFilterUwFlowAlerts(alerts, "SPX");
    expect(out).toHaveLength(2);
  });
});