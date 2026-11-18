import { describe, expect, it } from "vitest";
import {
  createDeskFlowAggregatorInternal,
  deskFlowAggregatorMarkConnected,
  deskFlowAggregatorProject,
  reduceDeskFlowFrame,
} from "../deskFlowAggregator";
import { formatGlanceMoneyRow } from "../deskFlowGlanceCopy";

describe("formatGlanceMoneyRow", () => {
  it("formats index calls/puts bought and sold", () => {
    let s = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("index"), true);
    s = reduceDeskFlowFrame(s, {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: Date.now() - 2_000,
      call_buy: 5.9e6,
      call_sell: 1.1e6,
      put_buy: 1.2e6,
      put_sell: 18.1e6,
      rx_ts_ms: Date.now(),
    });
    const row = formatGlanceMoneyRow(deskFlowAggregatorProject(s));
    expect(row.line).toMatch(/CALLS/);
    expect(row.line).toMatch(/PUTS/);
    expect(row.line).not.toMatch(/bull|bear|regime/i);
  });
});