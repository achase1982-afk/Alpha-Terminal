import { describe, expect, it } from "vitest";
import { AtLadderVolumeHeatEngine } from "../atLadderVolumeHeatEngine";

const C = "SPXW251118C00754500";

describe("AtLadderVolumeHeatEngine", () => {
  it("baselines first cumulative with no delta", () => {
    const eng = new AtLadderVolumeHeatEngine();
    eng.setSourceLive(true);
    eng.ingestCumulative(C, 1000, 1_000);
    eng.setNowMs(2_000);
    const snap = eng.snapshot([C]);
    expect(snap[C]!.contracts30s).toBe(0);
    expect(snap[C]!.availability).toBe("quiet");
  });

  it("sums deltas in 30s window", () => {
    const eng = new AtLadderVolumeHeatEngine();
    eng.setSourceLive(true);
    const t0 = 1_000_000;
    eng.setNowMs(t0);
    eng.ingestCumulative(C, 100, t0);
    eng.ingestCumulative(C, 150, t0 + 1_000);
    eng.ingestCumulative(C, 400, t0 + 5_000);
    eng.setNowMs(t0 + 10_000);
    expect(eng.snapshot([C])[C]!.contracts30s).toBe(300);
  });

  it("rebaselines on backwards cumulative", () => {
    const eng = new AtLadderVolumeHeatEngine();
    eng.setSourceLive(true);
    const t0 = 2_000_000;
    eng.setNowMs(t0);
    eng.ingestCumulative(C, 500, t0);
    eng.ingestCumulative(C, 520, t0 + 1_000);
    eng.ingestCumulative(C, 200, t0 + 2_000);
    eng.ingestCumulative(C, 250, t0 + 3_000);
    eng.setNowMs(t0 + 5_000);
    expect(eng.snapshot([C])[C]!.contracts30s).toBe(50);
  });

  it("drops reconnect gap bursts", () => {
    const eng = new AtLadderVolumeHeatEngine({ reconnectJumpContracts: 1_000 });
    eng.setSourceLive(true);
    const t0 = 3_000_000;
    eng.setNowMs(t0);
    eng.ingestCumulative(C, 10, t0);
    eng.ingestCumulative(C, 50_000, t0 + 1_000);
    eng.ingestCumulative(C, 50_020, t0 + 2_000);
    eng.setNowMs(t0 + 3_000);
    const view = eng.snapshot([C])[C]!;
    expect(view.contracts30s).toBe(20);
    expect(view.availability).toBe("stale");
  });

  it("reports unavailable when source not live", () => {
    const eng = new AtLadderVolumeHeatEngine();
    eng.ingestCumulative(C, 100, 0);
    eng.ingestCumulative(C, 200, 1_000);
    eng.setNowMs(2_000);
    expect(eng.snapshot([C])[C]!.availability).toBe("unavailable");
  });

  it("gates live badge on source freshness timestamp", () => {
    const eng = new AtLadderVolumeHeatEngine({ staleAfterMs: 5_000 });
    eng.setSourceLive(true);
    const t0 = 5_000_000;
    eng.ingestCumulative(C, 10, t0);
    eng.setNowMs(t0 + 1_000);
    expect(eng.isSourceFresh(t0 + 1_000)).toBe(true);
    expect(eng.isSourceFresh(t0 + 6_000)).toBe(false);
  });
});