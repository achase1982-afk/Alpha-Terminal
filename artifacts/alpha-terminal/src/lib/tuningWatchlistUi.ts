/**
 * UI-only mirror of backend tuning watchlist metadata in the server data module.
 * Keep labels, sizes, and symbol lists in sync when tuning watchlists change.
 */
export type TuningWatchlist = "mega_cap_core" | "active_trade" | "cyclicals_macro";

export const TUNING_UNIVERSE_PREFIX = "tuning:" as const;

/** Dropdown / persisted universe id → API `tuning_watchlist` query value. */
export function parseTuningUniverseSelection(universeId: string): TuningWatchlist | null {
  if (!universeId.startsWith(TUNING_UNIVERSE_PREFIX)) return null;
  const key = universeId.slice(TUNING_UNIVERSE_PREFIX.length);
  if (key === "mega_cap_core" || key === "active_trade" || key === "cyclicals_macro") return key;
  return null;
}

export const WATCHLIST_LABELS: Record<TuningWatchlist, string> = {
  mega_cap_core: "Mega Cap Core",
  active_trade: "Active Trade Names",
  cyclicals_macro: "Cyclicals & Macro",
};

export const WATCHLIST_SIZES: Record<TuningWatchlist, number> = {
  mega_cap_core: 8,
  active_trade: 8,
  cyclicals_macro: 6,
};

/** Symbol roster per watchlist (must match `tuningUniverse.ts` on the server). */
export const TUNING_WATCHLIST_SYMBOLS: Record<TuningWatchlist, readonly string[]> = {
  mega_cap_core: ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "TSLA"],
  active_trade: ["MU", "ORCL", "MRVL", "SMCI", "ADBE", "RIVN", "IONQ", "PLTR"],
  cyclicals_macro: ["JPM", "COF", "XOM", "LLY", "NFLX", "COST"],
};
