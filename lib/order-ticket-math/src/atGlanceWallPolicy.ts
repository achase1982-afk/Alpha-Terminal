import type { UwGammaZoneModel } from "./uwGammaZonesTypes.js";

export type GlanceWallPresentation = UwGammaZoneModel & {
  /** When set, header/ladder show `— ${wallsRollLabel}` for walls and flip. */
  wallsRollLabel?: string | null;
  /** Kept for older snapshots. Current policy does not collapse the two walls into a pin. */
  gammaPinStrike?: number | null;
  /** Expiry backing the snapshot (for debugging / tests). */
  dataExpiry?: string;
  /** True when snapshot expiry is before desk session date. */
  staleExpiry?: boolean;
};

/**
 * Desk policy: stale prior-day 0DTE snapshots keep net GEX + closed caption but
 * walls/flip roll forward at open.
 * Call and put walls stay on their own strikes, including when both land on one strike.
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
      callWallVol: null,
      putWallVol: null,
      flip: null,
      wallsRollLabel: "rolls at open",
      gammaPinStrike: null,
      dataExpiry: opts.expiryYmd,
      staleExpiry: true,
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