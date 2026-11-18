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
  | "heat-reconnect-gap";

export type AtVolumeFixtureSample = {
  contract: string;
  cumulativeVol: number;
  offsetMs?: number;
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
    default:
      return [];
  }
}