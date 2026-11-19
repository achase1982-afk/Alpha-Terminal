import { AT_LADDER_HEAT_WINDOW_MS } from "./atLadderVolumeHeatEngine";

/** Trade time for a heat sample. Unknown age is not "now", and an old print stays old. */
export function resolveHeatSampleMs(rawMs: number | null | undefined, nowMs: number): number | null {
  if (typeof rawMs !== "number" || !Number.isFinite(rawMs) || rawMs <= 0) return null;
  return rawMs > nowMs ? nowMs : rawMs;
}

/** The heat badge is fresh only while that sample is still inside the 30s window. */
export function heatSampleLightsBadge(
  sampleMs: number | null,
  nowMs: number,
  windowMs = AT_LADDER_HEAT_WINDOW_MS,
): boolean {
  if (sampleMs == null) return false;
  const age = nowMs - sampleMs;
  return age >= 0 && age <= windowMs;
}
