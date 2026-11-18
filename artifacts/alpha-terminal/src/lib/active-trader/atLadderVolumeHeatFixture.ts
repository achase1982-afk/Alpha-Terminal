import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

const FIXTURE_EXPIRY = "2026-11-17";

export const FIXTURE_VOL_CALL_7545 = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, 7545, "C");
export const FIXTURE_VOL_PUT_7530 = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, 7530, "P");
export const FIXTURE_VOL_CALL_7560 = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, 7560, "C");

export type AtLadderVolumeHeatFixtureScene =
  | "heat-quiet"
  | "heat-100k-vs-1m"
  | "heat-off-center"
  | "heat-fade"
  | "heat-reset"
  | "heat-backwards"
  | "heat-reconnect-gap"
  | "heat-cache-hit"
  | "heat-zero-trade-time"
  | "heat-quote-only-tick";

export type AtVolumeFixtureSample = {
  contract: string;
  cumulativeVol: number;
  offsetMs?: number;
  /** Explicit trade-time ms for ingest (poll/stream parity). */
  sampleMs?: number;
};

export function ladderVolumeHeatFixtureSamples(scene: AtLadderVolumeHeatFixtureScene): AtVolumeFixtureSample[] {
  switch (scene) {
    case "heat-quiet":
      return [{ contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 500, offsetMs: 0 }];
    case "heat-100k-vs-1m":
      return [
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 1_000, offsetMs: 0 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 1_150, offsetMs: 400 },
        { contract: FIXTURE_VOL_PUT_7530, cumulativeVol: 2_000, offsetMs: 200 },
        { contract: FIXTURE_VOL_PUT_7530, cumulativeVol: 12_000, offsetMs: 600 },
      ];
    case "heat-off-center":
      return [
        { contract: FIXTURE_VOL_CALL_7560, cumulativeVol: 100, offsetMs: 0 },
        { contract: FIXTURE_VOL_CALL_7560, cumulativeVol: 900, offsetMs: 300 },
      ];
    case "heat-fade":
      return [
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 100, offsetMs: -40_000 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 500, offsetMs: -35_000 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 500, offsetMs: 0 },
      ];
    case "heat-reset":
      return [
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 50_000, offsetMs: 0 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 120, offsetMs: 500 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 250, offsetMs: 900 },
      ];
    case "heat-backwards":
      return [
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 1_000, offsetMs: 0 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 1_080, offsetMs: 300 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 900, offsetMs: 500 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 950, offsetMs: 800 },
      ];
    case "heat-reconnect-gap":
      return [
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 200, offsetMs: 0 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 200, offsetMs: 400 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 80_000, offsetMs: 600 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 80_050, offsetMs: 1_200 },
      ];
    case "heat-cache-hit":
      return [
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 100, offsetMs: 0 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 100, offsetMs: 0 },
        { contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 130, offsetMs: 500 },
      ];
    case "heat-zero-trade-time":
      return [{ contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 100, sampleMs: 0 }];
    case "heat-quote-only-tick":
      return [{ contract: FIXTURE_VOL_CALL_7545, cumulativeVol: 100, sampleMs: 2_000_000 }];
    default:
      return [];
  }
}

/** Realistic 30s contract volume deltas across the SPX ladder for default dev fixture scenes. */
export function defaultFixtureLadderVolumeSamples(): AtVolumeFixtureSample[] {
  const samples: AtVolumeFixtureSample[] = [];
  const spot = 7540;
  for (let strike = 7440; strike <= 7640; strike += 5) {
    const callKey = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, strike, "C");
    const putKey = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, strike, "P");
    const distSteps = Math.abs(strike - spot) / 5;
    // Call volume concentrates near ATM and slightly OTM calls (7540–7555), tapering smoothly away.
    const callDelta = Math.max(
      2,
      Math.round(
        (strike >= spot - 5 && strike <= spot + 15 ? 88 : 34) * Math.exp(-distSteps * 0.28) +
          (strike === 7545 ? 42 : strike === 7550 ? 28 : 0),
      ),
    );
    // Put volume concentrates near ATM and slightly OTM puts (7525–7540), tapering smoothly away.
    const putDelta = Math.max(
      2,
      Math.round(
        (strike <= spot + 5 && strike >= spot - 15 ? 96 : 32) * Math.exp(-distSteps * 0.28) +
          (strike === 7535 ? 48 : strike === 7530 ? 34 : 0),
      ),
    );
    samples.push(
      { contract: callKey, cumulativeVol: 2_000, offsetMs: -12_000 },
      { contract: callKey, cumulativeVol: 2_000 + callDelta, offsetMs: -1_200 },
      { contract: putKey, cumulativeVol: 2_400, offsetMs: -12_000 },
      { contract: putKey, cumulativeVol: 2_400 + putDelta, offsetMs: -900 },
    );
  }
  return samples;
}