import { describe, expect, it } from "vitest";
import {
  createDeskFlowAggregatorInternal,
  deskFlowAggregatorMarkConnected,
  deskFlowAggregatorProject,
  reduceDeskFlowFrame,
} from "../deskFlowAggregator";

describe("deskFlowAggregator", () => {
  it("sums index 1m from flow_1s and 5m from flow_60s", () => {
    const base = 10_000;
    let s = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("index", base), true);
    s = reduceDeskFlowFrame(s, {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: base - 5_000,
      call_buy: 2e6,
      call_sell: 0.5e6,
      put_buy: 0.3e6,
      put_sell: 1e6,
      rx_ts_ms: base,
    });
    s = reduceDeskFlowFrame(s, {
      type: "flow_60s",
      sym: "SPX",
      bar_start_ms: base - 4 * 60_000,
      call_buy: 1e6,
      call_sell: 0.2e6,
      put_buy: 0.1e6,
      put_sell: 0.4e6,
      rx_ts_ms: base,
    });
  const out = deskFlowAggregatorProject(s);
  expect(out.index?.callBuy1m).toBe(2e6);
  expect(out.index?.callBuy5m).toBeGreaterThanOrEqual(1e6);
    expect(out.connection).toBe("live");
  });

  it("marks no prints when connected but empty", () => {
    const s = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("stock"), true);
    const out = deskFlowAggregatorProject(s);
    expect(out.connection).toBe("no_prints");
  });
});