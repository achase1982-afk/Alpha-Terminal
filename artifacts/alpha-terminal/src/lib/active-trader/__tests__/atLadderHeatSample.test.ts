import { describe, expect, it } from "vitest";
import { AtLadderVolumeHeatEngine, AT_LADDER_HEAT_WINDOW_MS } from "../atLadderVolumeHeatEngine";
import { heatSampleLightsBadge, resolveHeatSampleMs } from "../atLadderHeatSample";

const C = "SPXW251119C06000000";
const NOW = Date.parse("2026-11-18T19:30:00.000Z");

describe("ladder heat sample age", () => {
  it("keeps the trade time and leaves an unknown sample unpainted", () => {
    expect(resolveHeatSampleMs(null, NOW)).toBeNull();
    expect(resolveHeatSampleMs(undefined, NOW)).toBeNull();
    expect(resolveHeatSampleMs(0, NOW)).toBeNull();
    const expired = NOW - 60_000;
    expect(resolveHeatSampleMs(expired, NOW)).toBe(expired);
    expect(resolveHeatSampleMs(expired, NOW)).toBeLessThan(NOW - 5_000);
  });

  it("lights a fresh delta, ignores an expired burst, and ages out with the badge", () => {
    const eng = new AtLadderVolumeHeatEngine({ smoothingMs: 0, staleAfterMs: 35_000 });
    eng.setSourceLive(true);

    const expired = resolveHeatSampleMs(NOW - 60_000, NOW)!;
    eng.ingestCumulative(C, 1_000, expired - 1_000);
    eng.ingestCumulative(C, 1_400, expired);
    eng.setNowMs(NOW);
    const dark = eng.snapshot([C])[C]!;
    expect(dark.intensity).toBe(0);
    expect(dark.availability).not.toBe("live");
    expect(heatSampleLightsBadge(eng.getSourceLastRxMs(), NOW)).toBe(false);

    const fresh = resolveHeatSampleMs(NOW - 1_000, NOW)!;
    eng.ingestCumulative(C, 1_600, fresh);
    eng.setNowMs(NOW);
    const lit = eng.snapshot([C])[C]!;
    expect(lit.contracts30s).toBe(200);
    expect(lit.intensity).toBeGreaterThan(0);
    expect(lit.availability).toBe("live");
    expect(heatSampleLightsBadge(eng.getSourceLastRxMs(), NOW)).toBe(true);

    const later = fresh + AT_LADDER_HEAT_WINDOW_MS + 1;
    eng.setNowMs(later);
    const aged = eng.snapshot([C])[C]!;
    expect(aged.contracts30s).toBe(0);
    expect(aged.intensity).toBe(0);
    expect(aged.availability).not.toBe("live");
    expect(heatSampleLightsBadge(eng.getSourceLastRxMs(), later)).toBe(false);
  });
});
