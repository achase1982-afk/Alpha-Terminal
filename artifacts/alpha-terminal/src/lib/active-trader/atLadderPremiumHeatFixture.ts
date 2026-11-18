import type { AtLadderOptionPrint } from "./atLadderOptionPrint";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

const NOW = Date.now();
const FIXTURE_EXPIRY = "2026-11-17";

/** Contract keys aligned with `spxFixture` streamKeys. */
export const FIXTURE_HEAT_CALL_7545 = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, 7545, "C");
export const FIXTURE_HEAT_PUT_7530 = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, 7530, "P");
export const FIXTURE_HEAT_CALL_7560 = buildSchwabOptionKey("SPX", FIXTURE_EXPIRY, 7560, "C");

export type AtLadderHeatFixtureScene =
  | "heat-quiet"
  | "heat-100k-vs-1m"
  | "heat-off-center"
  | "heat-fade";

export function ladderHeatFixturePrints(scene: AtLadderHeatFixtureScene, t0 = NOW): AtLadderOptionPrint[] {
  switch (scene) {
    case "heat-quiet":
      return [];
    case "heat-100k-vs-1m":
      return [
        { contract: FIXTURE_HEAT_CALL_7545, px: 1.0, qty: 100, ts_ms: t0, seq: "a1" },
        { contract: FIXTURE_HEAT_PUT_7530, px: 4.0, qty: 2500, ts_ms: t0 + 500, seq: "b1" },
      ];
    case "heat-off-center":
      return [{ contract: FIXTURE_HEAT_CALL_7560, px: 2.5, qty: 800, ts_ms: t0, seq: "c1" }];
    case "heat-fade":
      return [
        { contract: FIXTURE_HEAT_CALL_7545, px: 3.0, qty: 400, ts_ms: t0 - 35_000, seq: "d1" },
        { contract: FIXTURE_HEAT_CALL_7545, px: 1.0, qty: 10, ts_ms: t0 - 20_000, seq: "d2" },
      ];
    default:
      return [];
  }
}