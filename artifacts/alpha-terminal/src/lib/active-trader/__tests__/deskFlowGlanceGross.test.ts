import { describe, expect, it } from "vitest";
import {
  createDeskFlowAggregatorInternal,
  deskFlowAggregatorMarkConnected,
  deskFlowAggregatorProject,
  reduceDeskFlowFrame,
} from "../deskFlowAggregator";
import { buildDeskGrossFlowGlance } from "../deskFlowGlanceGross";

describe("buildDeskGrossFlowGlance", () => {
  it("exposes gross sold/bought labels for calls and puts", () => {
    let s = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("index"), true);
    const now = Date.now();
    s = reduceDeskFlowFrame(s, {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: now - 2_000,
      call_buy: 5.9e6,
      call_sell: 1.1e6,
      put_buy: 1.2e6,
      put_sell: 18.1e6,
      rx_ts_ms: now,
    });
    const g = buildDeskGrossFlowGlance(deskFlowAggregatorProject(s), "1m", { nowMs: now });
    expect(g.calls?.sellLabel).toMatch(/^Sold \$/);
    expect(g.calls?.buyLabel).toMatch(/^Bought \$/);
    expect(g.netCalls).toBe(5.9e6 - 1.1e6);
  });
});