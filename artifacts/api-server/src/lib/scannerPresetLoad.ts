import { getUniverseSnapshot } from "./universeBuilder.js";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import { MID_CAP_200_SYMBOL_STRINGS } from "../data/midCap200Symbols.js";

/** Static presets only (no Core 383 / sector buckets — those come from `getUniverseSnapshot()`). */
export const STATIC_PRESET_UNIVERSES: Record<string, { label: string; description: string; symbols: string[] }> = {
  liquidCore130: {
    label: "Liquid Core 130",
    description: "130 ultra-liquid, options-tradable names across 9 sectors — primary scan universe",
    symbols: [...LIQUID_CORE_SYMBOL_STRINGS],
  },
  midcap200: {
    label: "Mid-Cap 200",
    description: "~200 options-liquid mid-cap stocks ($2B–$10B market cap)",
    symbols: [...MID_CAP_200_SYMBOL_STRINGS],
  },
};

const SECTOR_SHORTHAND_REVERSE: Record<string, string> = {
  "Information Technology": "TOP_TECH",
  "Health Care": "TOP_HEALTHCARE",
  "Financials": "TOP_FINANCIALS",
  "Industrials": "TOP_INDUSTRIALS",
  "Energy": "TOP_ENERGY",
  "Consumer Discretionary": "TOP_CONS_DISC",
  "Consumer Staples": "TOP_CONS_STAPLES",
  "Communication Services": "TOP_COMM_SVCS",
  "Materials": "TOP_MATERIALS",
  "Utilities": "TOP_UTILITIES",
  "Real Estate": "TOP_REAL_ESTATE",
};

const SECTOR_LABELS: Record<string, string> = {
  "Information Technology": "Top Tech",
  "Health Care": "Top Healthcare",
  "Financials": "Top Financials",
  "Industrials": "Top Industrials",
  "Energy": "Top Energy",
  "Consumer Discretionary": "Top Consumer Disc.",
  "Consumer Staples": "Top Consumer Staples",
  "Communication Services": "Top Comm. Services",
  "Materials": "Top Materials",
  "Utilities": "Top Utilities",
  "Real Estate": "Top Real Estate",
};

export const PRESET_ALIASES: Record<string, string> = {
  sp500: "liquidCore130",
  sp100: "liquidCore130",
  ndx100: "liquidCore130",
};

export function loadPresets(): Record<string, { label: string; description: string; symbols: string[] }> {
  const combined: Record<string, { label: string; description: string; symbols: string[] }> = {
    ...STATIC_PRESET_UNIVERSES,
  };

  const snap = getUniverseSnapshot();
  const coreSymbols = snap?.symbols ?? [];
  combined.core383 = {
    label: "Core Balanced 383",
    description:
      snap && coreSymbols.length > 0
        ? `${coreSymbols.length} sector-balanced, options-liquid stocks (built ${new Date(snap.buildTimestamp).toLocaleDateString()})`
        : "Sector-balanced options-liquid breadth universe (same snapshot as Market Pulse; symbols populate after universe build).",
    symbols: coreSymbols,
  };

  if (snap && snap.symbols.length > 0) {
    for (const [sector, syms] of Object.entries(snap.bySector)) {
      const key = SECTOR_SHORTHAND_REVERSE[sector];
      if (key && syms.length > 0) {
        combined[key.toLowerCase()] = {
          label: SECTOR_LABELS[sector] ?? sector,
          description: `${syms.length} top options-liquid ${sector} stocks`,
          symbols: syms,
        };
      }
    }

    for (const [key, syms] of Object.entries(snap.subSectorBuckets)) {
      if (syms.length > 0) {
        const label = key.replace("TOP_", "Top ").replace(/_/g, " ");
        combined[key.toLowerCase()] = {
          label,
          description: `${syms.length} top ${label.toLowerCase()} stocks by market cap`,
          symbols: syms,
        };
      }
    }
  }

  return combined;
}
