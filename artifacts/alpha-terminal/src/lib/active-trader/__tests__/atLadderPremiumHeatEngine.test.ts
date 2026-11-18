import { describe, expect, it } from "vitest";
import { AtLadderPremiumHeatEngine } from "../atLadderPremiumHeatEngine";

const C = "SPXW251118C07340000";

describe("AtLadderPremiumHeatEngine", () => {
  it("dedupes on seq", () => {
    const eng = new AtLadderPremiumHeatEngine();
    eng.setSourceLive(true);
    eng.setNowMs(10_000);
    eng.ingest({ contract: C, px: 1, qty: 100, ts_ms: 9_000, seq: 1 });
    eng.ingest({ contract: C, px: 5, qty: 100, ts_ms: 9_100, seq: 1 });
    expect(eng.premiumUsdForContract(C)).toBe(10_000);
  });

  it("removes premium on cancel", () => {
    const eng = new AtLadderPremiumHeatEngine();
    eng.setSourceLive(true);
    eng.setNowMs(10_000);
    eng.ingest({ contract: C, px: 2, qty: 500, ts_ms: 9_000, seq: "x" });
    expect(eng.premiumUsdForContract(C)).toBe(100_000);
    eng.ingest({ contract: C, px: 0, qty: 0, ts_ms: 9_500, seq: "x", cancel: true });
    expect(eng.premiumUsdForContract(C)).toBe(0);
  });

  it("expires prints outside 30s window", () => {
    const eng = new AtLadderPremiumHeatEngine();
    eng.setSourceLive(true);
    eng.ingest({ contract: C, px: 4, qty: 2500, ts_ms: 0, seq: "big" });
    eng.setNowMs(31_000);
    expect(eng.premiumUsdForContract(C)).toBe(0);
  });

  it("reports unavailable when source not live", () => {
    const eng = new AtLadderPremiumHeatEngine();
    eng.setNowMs(1_000);
    const snap = eng.snapshot([C]);
    expect(snap[C]!.availability).toBe("unavailable");
  });
});