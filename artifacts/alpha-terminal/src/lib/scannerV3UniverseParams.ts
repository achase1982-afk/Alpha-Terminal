/** Maps dropdown preset keys to the `universe` query value for GET /api/scanner/v3/universe. */
const PRESET_KEY_TO_V3_UNIVERSE_QUERY: Record<string, string> = {
  liquidCore130: "liquid-core-130",
  midcap200: "mid-cap-200",
  core383: "core-balanced-383",
  top_tech: "top-tech",
  top_healthcare: "top-healthcare",
  top_financials: "top-financials",
  top_industrials: "top-industrials",
  top_cons_disc: "top-consumer-disc",
  top_comm_svcs: "top-comm-services",
  top_energy: "top-energy",
  top_cons_staples: "top-consumer-staples",
  top_materials: "top-materials",
  top_utilities: "top-utilities",
  top_real_estate: "top-real-estate",
};

const TUNING_PREFIX = "tuning:";

/**
 * Maps the scanner universe dropdown value to the `universe` query string for GET /api/scanner/v3/universe.
 * Tuning bench selections use Liquid Core 130 for the wire payload, then the client filters to the watchlist.
 */
export function scannerV3UniverseQueryFromSelection(universeId: string): string {
  if (universeId.startsWith(TUNING_PREFIX)) {
    return "liquid-core-130";
  }
  if (universeId.startsWith("preset:")) {
    const key = universeId.slice(7);
    return PRESET_KEY_TO_V3_UNIVERSE_QUERY[key] ?? universeId;
  }
  return universeId;
}
