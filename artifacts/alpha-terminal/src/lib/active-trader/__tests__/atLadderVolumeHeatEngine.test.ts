import { describe, expect, it } from "vitest";
import {
  AT_HEAT_FLOOR_CONTRACTS,
  AtLadderRelativeHeatReference,
  AtLadderVolumeHeatEngine,
  ladderHeatIntensity,
} from "../atLadderVolumeHeatEngine";

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
    eng.ingestCumulative(C, 18, t0 + 500);
    eng.setNowMs(t0 + 1_000);
    expect(eng.isSourceFresh(t0 + 1_000)).toBe(true);
    expect(eng.isSourceFresh(t0 + 6_000)).toBe(false);
  });

  it("does not refresh badge on baseline or duplicate cache samples", () => {
    const eng = new AtLadderVolumeHeatEngine();
    eng.setSourceLive(true);
    const t0 = 6_000_000;
    eng.setNowMs(t0);
    eng.ingestCumulative(C, 100, t0);
    expect(eng.getSourceLastRxMs()).toBeNull();
    eng.ingestCumulative(C, 100, t0);
    expect(eng.getSourceLastRxMs()).toBeNull();
    eng.ingestCumulative(C, 130, t0 + 500);
    expect(eng.getSourceLastRxMs()).toBe(t0 + 500);
    eng.setNowMs(t0 + 1_000);
    expect(eng.contractsFor(C)).toBe(30);
  });

  it("quote-only tick path: identical cumulative does not advance source rx", () => {
    const eng = new AtLadderVolumeHeatEngine();
    eng.setSourceLive(true);
    const t0 = 7_000_000;
    eng.ingestCumulative(C, 80, t0);
    eng.ingestCumulative(C, 95, t0 + 200);
    const rx = eng.getSourceLastRxMs();
    eng.ingestCumulative(C, 95, t0 + 9_000);
    expect(eng.getSourceLastRxMs()).toBe(rx);
  });
});

/** Feed `contracts` traded inside the window to one contract of a live engine. */
function trade(eng: AtLadderVolumeHeatEngine, key: string, contracts: number, atMs: number, base = 1_000): void {
  eng.ingestCumulative(key, base, atMs - 1_000);
  eng.ingestCumulative(key, base + contracts, atMs);
}

describe("ladder heat scale", () => {
  /** Contracts per 30s, per contract, in the last 80s of an SPX 0DTE session (scripts/fixtures). */
  const REAL = { C7325: 1138, P7320: 994, C7330: 957, P7325: 446, C7335: 253, P7335: 115, P7340: 65, C7315: 44, far: 5 };

  it("lights the busiest contract fully and keeps small ones clearly visible", () => {
    const ref = REAL.C7325;
    expect(ladderHeatIntensity(REAL.C7325, ref)).toBe(1);
    expect(ladderHeatIntensity(REAL.P7325, ref)).toBeGreaterThan(0.7);
    expect(ladderHeatIntensity(REAL.P7335, ref)).toBeGreaterThan(0.45);
    expect(ladderHeatIntensity(REAL.C7315, ref)).toBeGreaterThan(0.3);
    expect(ladderHeatIntensity(REAL.far, ref)).toBeGreaterThan(0.05);
  });

  it("keeps a 50-contract strike visible next to a 2,000-contract one", () => {
    expect(ladderHeatIntensity(50, 2_000)).toBeGreaterThan(0.3);
    // A straight ratio would put it at 2.5%.
    expect(ladderHeatIntensity(50, 2_000)).toBeGreaterThan((50 / 2_000) * 10);
  });

  it("orders contracts by volume", () => {
    const values = [REAL.far, REAL.C7315, REAL.P7340, REAL.P7335, REAL.C7335, REAL.P7325, REAL.C7330, REAL.P7320];
    const shades = values.map((n) => ladderHeatIntensity(n, REAL.C7325));
    for (let i = 1; i < shades.length; i++) expect(shades[i]!).toBeGreaterThan(shades[i - 1]!);
  });

  it("does not let a single 1-lot light a cell on a quiet tape", () => {
    expect(ladderHeatIntensity(1, 1)).toBeLessThan(0.1);
    expect(ladderHeatIntensity(5, 5)).toBeLessThan(0.3);
    expect(ladderHeatIntensity(AT_HEAT_FLOOR_CONTRACTS, AT_HEAT_FLOOR_CONTRACTS)).toBe(1);
    expect(ladderHeatIntensity(0, 500)).toBe(0);
  });

  it("the reference jumps up at once, eases down, and stops at the floor", () => {
    const ref = new AtLadderRelativeHeatReference(50, 20_000);
    expect(ref.update(0, 0)).toBe(50);
    expect(ref.update(1_200, 1_000)).toBe(1_200);
    // Busiest contract cooled to 300: half-way down after one half-life, not at once.
    expect(ref.update(300, 21_000)).toBeCloseTo(600, 0);
    expect(ref.update(300, 41_000)).toBe(300);
    expect(ref.update(0, 600_000)).toBe(50);
  });
});

describe("AtLadderVolumeHeatEngine relative heat", () => {
  const HOT = "SPXW  261118C07325000";
  const MID = "SPXW  261118P07335000";
  const LOW = "SPXW  261118C07355000";
  const t0 = 10_000_000;

  it("is visible at real volume levels", () => {
    const eng = new AtLadderVolumeHeatEngine({ smoothingMs: 0 });
    eng.setSourceLive(true);
    eng.setNowMs(t0);
    trade(eng, HOT, 1_138, t0);
    trade(eng, MID, 115, t0);
    trade(eng, LOW, 5, t0);
    eng.setNowMs(t0 + 100);
    const snap = eng.snapshot([HOT, MID, LOW]);
    expect(snap[HOT]!.intensity).toBe(1);
    expect(snap[MID]!.intensity).toBeGreaterThan(0.45);
    expect(snap[LOW]!.intensity).toBeGreaterThan(0.05);
    expect(snap[LOW]!.intensity).toBeLessThan(snap[MID]!.intensity);
    expect(eng.referenceContracts()).toBe(1_138);
  });

  it("scales against the busiest tracked contract even when it is off screen", () => {
    const eng = new AtLadderVolumeHeatEngine({ smoothingMs: 0 });
    eng.setSourceLive(true);
    eng.setNowMs(t0);
    trade(eng, HOT, 1_138, t0);
    trade(eng, LOW, 5, t0);
    eng.setNowMs(t0 + 100);
    const snap = eng.snapshot([LOW]);
    expect(snap[LOW]!.intensity).toBeLessThan(0.15);
  });

  it("fades as trades leave the 30s window", () => {
    const eng = new AtLadderVolumeHeatEngine({ smoothingMs: 0 });
    eng.setSourceLive(true);
    eng.setNowMs(t0);
    eng.ingestCumulative(HOT, 1_000, t0 - 1_000);
    eng.ingestCumulative(HOT, 1_400, t0);
    eng.ingestCumulative(HOT, 1_500, t0 + 20_000);
    eng.setNowMs(t0 + 21_000);
    expect(eng.snapshot([HOT])[HOT]!.contracts30s).toBe(500);
    eng.setNowMs(t0 + 31_000);
    const later = eng.snapshot([HOT])[HOT]!;
    expect(later.contracts30s).toBe(100);
    expect(later.intensity).toBeLessThan(1);
    eng.setNowMs(t0 + 51_000);
    expect(eng.snapshot([HOT])[HOT]!.intensity).toBe(0);
  });

  it("smooths each contract over time only", () => {
    const eng = new AtLadderVolumeHeatEngine({ smoothingMs: 450 });
    eng.setSourceLive(true);
    eng.setNowMs(t0);
    eng.ingestCumulative(HOT, 1_000, t0 - 1_000);
    eng.ingestCumulative(LOW, 1_000, t0 - 1_000);
    expect(eng.snapshot([HOT, LOW])[HOT]!.intensity).toBe(0);

    eng.ingestCumulative(HOT, 1_800, t0 + 50);
    eng.setNowMs(t0 + 100);
    const first = eng.snapshot([HOT, LOW]);
    expect(first[HOT]!.intensity).toBeGreaterThan(0);
    expect(first[HOT]!.intensity).toBeLessThan(0.5);
    // The quiet neighbour is not pulled up by the busy strike next to it.
    expect(first[LOW]!.intensity).toBe(0);

    eng.setNowMs(t0 + 3_000);
    expect(eng.snapshot([HOT, LOW])[HOT]!.intensity).toBeCloseTo(1, 2);
  });

  it("shows a contract's true value the first time it is painted", () => {
    const eng = new AtLadderVolumeHeatEngine({ smoothingMs: 450 });
    eng.setSourceLive(true);
    eng.setNowMs(t0);
    trade(eng, HOT, 900, t0);
    eng.setNowMs(t0 + 100);
    expect(eng.snapshot([HOT])[HOT]!.intensity).toBe(1);
  });
});

