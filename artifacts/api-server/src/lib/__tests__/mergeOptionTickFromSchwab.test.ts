import { describe, expect, it } from "vitest";
import { mergeOptionTickFromSchwab, type OptionTick } from "../schwabStreamer.js";

const baseExisting = (): OptionTick => ({
  key: "K1",
  bid: 1.2,
  ask: 1.3,
  last: 1.25,
  bidSize: 10,
  askSize: 12,
  volume: 100,
  openInterest: null,
  iv: 0.2,
  delta: 0.5,
  gamma: 0.01,
  theta: -0.05,
  vega: 0.1,
  mark: 1.26,
  change: 0.1,
  lastSize: 1,
  underlyingPrice: 5000,
  quoteTime: 100,
  tradeTime: 200,
  lastVolumeTradeTimeMs: 9_900,
  volumeSample: null,
  ts: 1,
});

describe("mergeOptionTickFromSchwab", () => {
  it("preserves bid/ask when a partial update omits them", () => {
    const existing = baseExisting();
    const merged = mergeOptionTickFromSchwab(existing, { "4": 1.28, "8": 105, "39": 10_000 }, "K1", 2);
    expect(merged.bid).toBe(1.2);
    expect(merged.ask).toBe(1.3);
    expect(merged.last).toBe(1.28);
    expect(merged.volume).toBe(105);
    expect(merged.volumeSample).toEqual({ cumulativeVol: 105, tradeTimeMs: 10_000 });
  });

  it("quote-only frame does not emit a volume sample", () => {
    const existing = baseExisting();
    const merged = mergeOptionTickFromSchwab(existing, { "2": 1.21, "38": 8_888 }, "K1", 2);
    expect(merged.volume).toBe(100);
    expect(merged.volumeSample).toBeNull();
    expect(merged.quoteTime).toBe(8_888);
  });

  it("equal field-8 and field-39 resend does not refresh volume sample", () => {
    const existing = baseExisting();
    const merged = mergeOptionTickFromSchwab(
      existing,
      { "8": 100, "39": 9_900, "2": 1.19 },
      "K1",
      3,
    );
    expect(merged.volume).toBe(100);
    expect(merged.volumeSample).toBeNull();
    expect(merged.lastVolumeTradeTimeMs).toBe(9_900);
  });

  it("field-8 increase with newer field 39 emits a sample", () => {
    const existing = baseExisting();
    const merged = mergeOptionTickFromSchwab(existing, { "8": 118, "39": 10_500 }, "K1", 4);
    expect(merged.volumeSample).toEqual({ cumulativeVol: 118, tradeTimeMs: 10_500 });
    expect(merged.lastVolumeTradeTimeMs).toBe(10_500);
  });

  it("field-8 present with tradeTimeInLong 0 skips volume sample", () => {
    const existing = baseExisting();
    const merged = mergeOptionTickFromSchwab(existing, { "8": 120, "39": 0 }, "K1", 5);
    expect(merged.volume).toBe(120);
    expect(merged.volumeSample).toBeNull();
  });

  it("field-8 increase on partial delta frame omitting field 39 emits sample at frame rx", () => {
    const existing = baseExisting();
    const merged = mergeOptionTickFromSchwab(existing, { "8": 125 }, "K1", 11_000);
    expect(merged.volume).toBe(125);
    expect(merged.volumeSample).toEqual({ cumulativeVol: 125, tradeTimeMs: 11_000 });
    expect(merged.lastVolumeTradeTimeMs).toBe(11_000);
  });
});