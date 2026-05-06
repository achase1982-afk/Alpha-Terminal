import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import { MID_CAP_200_SYMBOL_STRINGS } from "../data/midCap200Symbols.js";
import { loadPresets } from "./scannerPresetLoad.js";

export type ScannerUniverseId =
  | "liquid-core-130"
  | "mid-cap-200"
  | "core-balanced-383"
  | "top-tech"
  | "top-healthcare"
  | "top-financials"
  | "top-industrials"
  | "top-consumer-disc"
  | "top-comm-services"
  | "top-energy"
  | "top-consumer-staples"
  | "top-materials"
  | "top-utilities"
  | "top-real-estate";

export interface ScannerUniverse {
  id: ScannerUniverseId;
  label: string;
  symbols: string[];
  /** Where the symbol array is defined (for PR / ops docs). */
  symbolSource: string;
}

const LIQUID_CORE_SOURCE = "src/data/liquidCore130.ts — LIQUID_CORE_SYMBOL_STRINGS";
const MID_CAP_SOURCE = "src/data/midCap200Symbols.ts — MID_CAP_200_SYMBOL_STRINGS";
const CORE_383_SOURCE =
  "src/lib/universeBuilder.ts — buildCoreOptionsUniverse() snapshot symbols (merged in scannerPresetLoad.loadPresets as core383)";
const SECTOR_SOURCE =
  "src/lib/universeBuilder.ts — sector slice from UniverseSnapshot.bySector (wired in scannerPresetLoad.loadPresets)";

function sectorSource(sector: string): string {
  return `${SECTOR_SOURCE} — sector "${sector}"`;
}

export const SCANNER_UNIVERSES: Record<ScannerUniverseId, ScannerUniverse> = {
  "liquid-core-130": {
    id: "liquid-core-130",
    label: "Liquid Core 130",
    symbols: [...LIQUID_CORE_SYMBOL_STRINGS],
    symbolSource: LIQUID_CORE_SOURCE,
  },
  "mid-cap-200": {
    id: "mid-cap-200",
    label: "Mid-Cap 200",
    symbols: [...MID_CAP_200_SYMBOL_STRINGS],
    symbolSource: MID_CAP_SOURCE,
  },
  "core-balanced-383": {
    id: "core-balanced-383",
    label: "Core Balanced 383",
    symbols: [],
    symbolSource: CORE_383_SOURCE,
  },
  "top-tech": {
    id: "top-tech",
    label: "Top Tech",
    symbols: [],
    symbolSource: sectorSource("Information Technology"),
  },
  "top-healthcare": {
    id: "top-healthcare",
    label: "Top Healthcare",
    symbols: [],
    symbolSource: sectorSource("Health Care"),
  },
  "top-financials": {
    id: "top-financials",
    label: "Top Financials",
    symbols: [],
    symbolSource: sectorSource("Financials"),
  },
  "top-industrials": {
    id: "top-industrials",
    label: "Top Industrials",
    symbols: [],
    symbolSource: sectorSource("Industrials"),
  },
  "top-consumer-disc": {
    id: "top-consumer-disc",
    label: "Top Consumer Disc.",
    symbols: [],
    symbolSource: sectorSource("Consumer Discretionary"),
  },
  "top-comm-services": {
    id: "top-comm-services",
    label: "Top Comm. Services",
    symbols: [],
    symbolSource: sectorSource("Communication Services"),
  },
  "top-energy": {
    id: "top-energy",
    label: "Top Energy",
    symbols: [],
    symbolSource: sectorSource("Energy"),
  },
  "top-consumer-staples": {
    id: "top-consumer-staples",
    label: "Top Consumer Staples",
    symbols: [],
    symbolSource: sectorSource("Consumer Staples"),
  },
  "top-materials": {
    id: "top-materials",
    label: "Top Materials",
    symbols: [],
    symbolSource: sectorSource("Materials"),
  },
  "top-utilities": {
    id: "top-utilities",
    label: "Top Utilities",
    symbols: [],
    symbolSource: sectorSource("Utilities"),
  },
  "top-real-estate": {
    id: "top-real-estate",
    label: "Top Real Estate",
    symbols: [],
    symbolSource: sectorSource("Real Estate"),
  },
};

const PRESET_KEY_BY_UNIVERSE_ID: Record<ScannerUniverseId, keyof ReturnType<typeof loadPresets> | null> = {
  "liquid-core-130": "liquidCore130",
  "mid-cap-200": "midcap200",
  "core-balanced-383": "core383",
  "top-tech": "top_tech",
  "top-healthcare": "top_healthcare",
  "top-financials": "top_financials",
  "top-industrials": "top_industrials",
  "top-consumer-disc": "top_cons_disc",
  "top-comm-services": "top_comm_svcs",
  "top-energy": "top_energy",
  "top-consumer-staples": "top_cons_staples",
  "top-materials": "top_materials",
  "top-utilities": "top_utilities",
  "top-real-estate": "top_real_estate",
};

export const SCANNER_UNIVERSE_IDS = Object.keys(SCANNER_UNIVERSES) as ScannerUniverseId[];

export function isScannerUniverseId(s: string): s is ScannerUniverseId {
  return (SCANNER_UNIVERSE_IDS as string[]).includes(s);
}

/** Tickers for a scanner v3 universe id, using the same preset keys as GET /api/scanner/universes (empty if snapshot missing for dynamic presets). */
export function getScannerUniverseTickers(id: ScannerUniverseId): string[] {
  const staticEntry = SCANNER_UNIVERSES[id];
  if (staticEntry.symbols.length > 0) {
    return [...staticEntry.symbols];
  }
  const presetKey = PRESET_KEY_BY_UNIVERSE_ID[id];
  if (!presetKey) return [];
  const presets = loadPresets();
  const row = presets[presetKey];
  return row?.symbols ? [...row.symbols] : [];
}
