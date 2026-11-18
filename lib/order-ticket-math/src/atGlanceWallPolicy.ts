import type { UwGammaZoneModel } from "./uwGammaZonesTypes.js";

export type GlanceWallPresentation = UwGammaZoneModel & {
  /** When set, header/ladder show `— ${wallsRollLabel}` for walls and flip. */
  wallsRollLabel?: string | null;
  /** UW coincident walls at ATM → single pin label. */
  gammaPinStrike?: number | null;
  /** Expiry backing the snapshot (for debugging / tests). */
  dataExpiry?: string;
  /** True when snapshot expiry is before desk session date. */
  staleExpiry?: boolean;
};

function nearStrike(a: number, b: number): boolean {
  return Math.abs(a - b) < Math.max(Math.abs(b) * 0.0005, 0.05);
}

/**
 * Desk policy: stale prior-day 0DTE snapshots keep net GEX + closed caption but
 * walls/flip roll forward at open; coincident ATM walls render as a pin.
 */
export function applyGlanceWallPolicy(
  zones: UwGammaZoneModel,
  opts: { expiryYmd: string; sessionDateYmd: string; spot: number | null },
): GlanceWallPresentation {
  const staleExpiry = opts.expiryYmd < opts.sessionDateYmd;
  if (staleExpiry) {
    return {
      ...zones,
      callWall: null,
      putWall: null,
      flip: null,
      wallsRollLabel: "rolls at open",
      gammaPinStrike: null,
      dataExpiry: opts.expiryYmd,
      staleExpiry: true,
    };
  }

  const { callWall, putWall } = zones;
  if (
    callWall != null &&
    putWall != null &&
    nearStrike(callWall, putWall) &&
    opts.spot != null &&
    nearStrike(callWall, opts.spot)
  ) {
    return {
      ...zones,
      callWall: null,
      putWall: null,
      gammaPinStrike: callWall,
      wallsRollLabel: null,
      dataExpiry: opts.expiryYmd,
      staleExpiry: false,
    };
  }

  return {
    ...zones,
    wallsRollLabel: null,
    gammaPinStrike: null,
    dataExpiry: opts.expiryYmd,
    staleExpiry: false,
  };
}