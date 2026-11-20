import { describe, expect, it } from "vitest";
import {
  createDeskFlowAggregatorInternal,
  deskFlowAggregatorMarkConnected,
  deskFlowAggregatorProject,
  reduceDeskFlowFrame,
} from "../deskFlowAggregator";

describe("deskFlowAggregator", () => {
  it("sums index 1m from flow_1s and 5m/hour from flow_60s", () => {
    const baseDate = new Date();
    baseDate.setMinutes(42, 10, 0);
    const base = baseDate.getTime();
    const hour0Date = new Date(base);
    hour0Date.setMinutes(0, 0, 0);
    const hour0 = hour0Date.getTime();
    let s = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("index", base), true);
    s = reduceDeskFlowFrame(s, {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: base - 30_000,
      call_buy: 2e6,
      call_sell: 0.5e6,
      put_buy: 0.3e6,
      put_sell: 1e6,
      rx_ts_ms: base,
    });
    const bars: { bar_start_ms: number; call_buy: number }[] = [
      { bar_start_ms: base - 240_000, call_buy: 1e6 },
      { bar_start_ms: base - 180_000, call_buy: 2e6 },
      { bar_start_ms: base - 120_000, call_buy: 3e6 },
      { bar_start_ms: hour0 + 60_000, call_buy: 4e6 },
      { bar_start_ms: hour0 + 120_000, call_buy: 5e6 },
    ];
    for (const b of bars) {
      s = reduceDeskFlowFrame(s, {
        type: "flow_60s",
        sym: "SPX",
        bar_start_ms: b.bar_start_ms,
        call_buy: b.call_buy,
        call_sell: 0.1e6,
        put_buy: 0.05e6,
        put_sell: 0.2e6,
        rx_ts_ms: base,
      });
    }
    const out = deskFlowAggregatorProject(s);
    expect(out.index?.callBuy1m).toBe(2e6);
    expect(out.index?.callBuy5m).toBe(6e6);
    expect(out.index?.callBuyHr).toBe(15e6);
    expect(out.index?.callBuyDay).toBe(2e6);
    expect(out.connection).toBe("live");
  });

  it("marks no prints when connected but empty", () => {
    const s = deskFlowAggregatorMarkConnected(createDeskFlowAggregatorInternal("stock"), true);
    const out = deskFlowAggregatorProject(s);
    expect(out.connection).toBe("no_prints");
  });
});