/**
 * UI-only mirror of backend tuning watchlist metadata in the server data module.
 * Keep labels and sizes in sync when tuning watchlists change.
 */
export type TuningWatchlist = "mega_cap_core" | "active_trade" | "cyclicals_macro";

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
