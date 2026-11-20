import { formatStrikeLevel } from "./atExpiryPill";
import type { ZoneModel } from "./zonesModel";

export type WallColumnDisplay = {
  label: string;
  value: string;
};

/** Header flow row wall column text. */
export function resolveCallWallDisplay(zones: ZoneModel): WallColumnDisplay {
  if (zones.wallsRollLabel) {
    return { label: "Call wall", value: "\u2014" };
  }
  if (zones.gammaPinStrike != null) {
    return { label: "Pin", value: formatStrikeLevel(zones.gammaPinStrike) };
  }
  return {
    label: "Call wall",
    value: zones.callWall != null ? formatStrikeLevel(zones.callWall) : "\u2014",
  };
}

export type GlanceWallLayout =
  | { mode: "shared"; label: string; value: string }
  | { mode: "split"; call: WallColumnDisplay; put: WallColumnDisplay };

/**
 * Closed walls share one row so the glance stays inside 440px.
 * The value is a dash when the strike is unavailable. Live strikes stay split.
 */
export function resolveGlanceWallLayout(zones: ZoneModel): GlanceWallLayout {
  if (zones.wallsRollLabel) {
    return {
      mode: "shared",
      label: "Call · Put wall",
      value: "\u2014",
    };
  }
  return {
    mode: "split",
    call: resolveCallWallDisplay(zones),
    put: resolvePutWallDisplay(zones),
  };
}

export function resolvePutWallDisplay(zones: ZoneModel): WallColumnDisplay {
  if (zones.wallsRollLabel) {
    return { label: "Put wall", value: "\u2014" };
  }
  if (zones.gammaPinStrike != null) {
    return { label: "Put wall", value: "\u2014" };
  }
  return {
    label: "Put wall",
    value: zones.putWall != null ? formatStrikeLevel(zones.putWall) : "\u2014",
  };
}

export function resolveGammaFlipDisplay(zones: ZoneModel): string {
  if (zones.wallsRollLabel) return "\u2014";
  if (zones.flip == null || !Number.isFinite(zones.flip)) return "none in range";
  return formatStrikeLevel(Math.round(zones.flip));
}

/** Ladder strike chip under ATM (pin supersedes separate walls). */
export function ladderStrikeZoneTag(
  zones: Pick<ZoneModel, "gammaPinStrike" | "wallsRollLabel" | "callWall" | "putWall">,
  strike: number,
): string | null {
  if (zones.gammaPinStrike != null && Math.abs(strike - zones.gammaPinStrike) < 0.001) {
    return "PIN";
  }
  if (zones.wallsRollLabel) return null;
  const isCallWall = zones.callWall != null && Math.abs(strike - zones.callWall) < 0.001;
  const isPutWall = zones.putWall != null && Math.abs(strike - zones.putWall) < 0.001;
  if (isCallWall && isPutWall) return "PIN";
  if (isCallWall) return "CALL WALL";
  if (isPutWall) return "PUT WALL";
  return null;
}