import { describe, expect, it } from "vitest";
import { formatGlanceMoneyRow } from "../deskFlowGlanceCopy";
import type { DeskFlowAggregate } from "../deskFlowAggregator";

describe("glance flow worst-case width", () => {
  it("keeps full 1.23B digits in separate 5m/hr lines", () => {
    const billion = 1.23e9;
    const agg: DeskFlowAggregate = {
      mode: "index",
      connection: "live",
      index: {
        callBuy1m: billion,
        callSell1m: billion,
        putBuy1m: billion,
        putSell1m: billion,
        callBuy5m: billion,
        callSell5m: billion,
        putBuy5m: billion,
        putSell5m: billion,
        callBuyHr: billion,
        callSellHr: billion,
        putBuyHr: billion,
        putSellHr: billion,
      },
      tape: null,
      livePx: null,
      lastRxMs: null,
    };
    const row = formatGlanceMoneyRow(agg);
    expect(row.line1m).toContain("Calls bought +1.23B");
    expect(row.line5m).toContain("sold 1.23B");
    expect(row.lineHr).toContain("Puts bought");
    expect(row.line5m).not.toMatch(/\.\.\./);
  });
});