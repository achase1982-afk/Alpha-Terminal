// ============================================================================
// tuningUniverse.ts
// ============================================================================
//
// Purpose
//   Curated 22-name test bench for scanner and strategist tuning.
//   Distinct from liquidCore130.ts (the production scanner universe).
//   All 22 names are persistently equity-subscribed via Schwab and IBKR
//   streamers, and fully backfilled across equity_daily, options_daily,
//   earnings_calendar, dividends, splits, computed earnings_reactions,
//   and computed hv_series.
//
// Watchlists
//   Watchlists scope SCAN EXECUTION (active options-chain pulls, AI
//   narrative passes), NOT data coverage. All 22 names are always
//   subscribed and always backfilled regardless of which watchlist is
//   active in the UI.
//
// Why no ETFs (SPY / QQQ / IWM)
//   The entire backfill stack here is earnings-anchored: 16Q EPS history,
//   4-year earnings reactions, FMP fundamentals. Index ETFs have none of
//   that. They re-enter via the production LC130 path or as separate
//   macro context, not here.
//
// Coexistence with liquidCore130
//   Importers should choose one or the other deliberately. Do NOT swap
//   this for LC130 in a production scanner code path.
//
// ============================================================================

import { LIQUID_CORE_SYMBOLS } from "./liquidCore130.js";

const LC_PRIMARY_LISTING = new Map<string, "NYSE" | "NASDAQ">();
for (const e of LIQUID_CORE_SYMBOLS) {
  if (e.primaryListing === "NYSE" || e.primaryListing === "NASDAQ") {
    LC_PRIMARY_LISTING.set(e.symbol.toUpperCase(), e.primaryListing);
  }
}

export type TuningPrimaryListing = "NYSE" | "NASDAQ";

/**
 * Primary listing for IBKR / venue routing (does not change backfill coverage).
 * Prefer `liquidCore130` when the symbol exists there.
 * Explicit locks from SEC company ticker / exchange mapping (NYSE vs Nasdaq), verified 2026-05-07:
 * ORCL and IONQ → NYSE; ADBE → NASDAQ.
 */
export function tuningPrimaryListing(symbol: string): TuningPrimaryListing {
  const u = symbol.toUpperCase();
  const fromLc = LC_PRIMARY_LISTING.get(u);
  if (fromLc) return fromLc;
  if (u === "ORCL" || u === "IONQ") return "NYSE";
  if (u === "ADBE") return "NASDAQ";
  return "NASDAQ";
}

export type TuningWatchlist =
  | 'mega_cap_core'
  | 'active_trade'
  | 'cyclicals_macro';

export type TuningSector =
  | 'mega_cap_tech'
  | 'semis'
  | 'consumer_discretionary'
  | 'consumer_staples'
  | 'financials'
  | 'energy'
  | 'healthcare'
  | 'communication_services'
  | 'enterprise_software'
  | 'speculative';

export type VolRegime = 'low' | 'mid' | 'high' | 'very_high';

export interface TuningUniverseEntry {
  symbol: string;
  watchlist: TuningWatchlist;
  sector: TuningSector;
  volRegime: VolRegime;
  primaryListing: TuningPrimaryListing;
  /** Names the trader actively deploys capital on. */
  activelyTraded: boolean;
  /** Brief rationale for inclusion. Visible in dashboards / logs. */
  rationale: string;
}

export const TUNING_UNIVERSE: TuningUniverseEntry[] = [
  // Watchlist 1: Mega Cap Core (8)
  { symbol: 'NVDA',  watchlist: 'mega_cap_core', sector: 'semis',                  volRegime: 'very_high', primaryListing: tuningPrimaryListing('NVDA'),  activelyTraded: false, rationale: 'AI/semis bellwether, max IV personality, fat earnings reactions' },
  { symbol: 'AAPL',  watchlist: 'mega_cap_core', sector: 'mega_cap_tech',          volRegime: 'low',       primaryListing: tuningPrimaryListing('AAPL'),  activelyTraded: false, rationale: 'Mega-cap tech, low IV, clean tape, threshold-calibration testbed' },
  { symbol: 'MSFT',  watchlist: 'mega_cap_core', sector: 'mega_cap_tech',          volRegime: 'low',       primaryListing: tuningPrimaryListing('MSFT'),  activelyTraded: false, rationale: 'Enterprise/cloud/AI mega cap, distinct from ORCL personality' },
  { symbol: 'GOOGL', watchlist: 'mega_cap_core', sector: 'communication_services', volRegime: 'mid',       primaryListing: tuningPrimaryListing('GOOGL'), activelyTraded: false, rationale: 'Search/ads/cloud/AI, antitrust overhang as unique signal' },
  { symbol: 'AMZN',  watchlist: 'mega_cap_core', sector: 'mega_cap_tech',          volRegime: 'mid',       primaryListing: tuningPrimaryListing('AMZN'),  activelyTraded: false, rationale: 'Retail cycle plus AWS, fattest earnings reactions among mega caps historically' },
  { symbol: 'META',  watchlist: 'mega_cap_core', sector: 'communication_services', volRegime: 'mid',       primaryListing: tuningPrimaryListing('META'),  activelyTraded: false, rationale: 'Ad-cycle binary on earnings, distinct from search/streaming patterns' },
  { symbol: 'AVGO',  watchlist: 'mega_cap_core', sector: 'semis',                  volRegime: 'mid',       primaryListing: tuningPrimaryListing('AVGO'),  activelyTraded: false, rationale: 'Custom silicon plus dividend, non-NVDA semi angle' },
  { symbol: 'TSLA',  watchlist: 'mega_cap_core', sector: 'consumer_discretionary', volRegime: 'high',      primaryListing: tuningPrimaryListing('TSLA'),  activelyTraded: false, rationale: 'High beta, retail-driven, fat-tailed mega cap' },

  // Watchlist 2: Active Trade Names (8)
  { symbol: 'MU',    watchlist: 'active_trade', sector: 'semis',                   volRegime: 'very_high', primaryListing: tuningPrimaryListing('MU'),    activelyTraded: true,  rationale: 'Memory cycle, market cap up over 100 percent in two months, ridiculous vol' },
  { symbol: 'ORCL',  watchlist: 'active_trade', sector: 'enterprise_software',     volRegime: 'mid',       primaryListing: tuningPrimaryListing('ORCL'),  activelyTraded: true,  rationale: 'Enterprise/cloud, distinct from MSFT personality' },
  { symbol: 'MRVL',  watchlist: 'active_trade', sector: 'semis',                   volRegime: 'high',      primaryListing: tuningPrimaryListing('MRVL'),  activelyTraded: true,  rationale: 'Hyperscaler custom silicon, optical, distinct earnings rhythm' },
  { symbol: 'SMCI',  watchlist: 'active_trade', sector: 'semis',                   volRegime: 'very_high', primaryListing: tuningPrimaryListing('SMCI'),  activelyTraded: true,  rationale: 'AI server hardware, accounting overhang, fattest reactions in cohort' },
  { symbol: 'ADBE',  watchlist: 'active_trade', sector: 'enterprise_software',     volRegime: 'mid',       primaryListing: tuningPrimaryListing('ADBE'),  activelyTraded: true,  rationale: 'Creative software cycle, AI-narrative impact on multiples' },
  { symbol: 'RIVN',  watchlist: 'active_trade', sector: 'consumer_discretionary',  volRegime: 'very_high', primaryListing: tuningPrimaryListing('RIVN'),  activelyTraded: true,  rationale: 'Sub-20 dollar EV mechanics, smaller cap volatility, retail-driven' },
  { symbol: 'IONQ',  watchlist: 'active_trade', sector: 'speculative',             volRegime: 'very_high', primaryListing: tuningPrimaryListing('IONQ'),  activelyTraded: true,  rationale: 'Quantum spec, narrative-driven, options-led tape' },
  { symbol: 'PLTR',  watchlist: 'active_trade', sector: 'enterprise_software',     volRegime: 'high',      primaryListing: tuningPrimaryListing('PLTR'),  activelyTraded: false, rationale: 'AI software (gov plus commercial), distinct from hardware AI cohort' },

  // Watchlist 3: Cyclicals & Macro (6)
  { symbol: 'JPM',   watchlist: 'cyclicals_macro', sector: 'financials',             volRegime: 'low', primaryListing: tuningPrimaryListing('JPM'),   activelyTraded: false, rationale: 'Bulge bracket, rate-sensitive, NIM cycle' },
  { symbol: 'COF',   watchlist: 'cyclicals_macro', sector: 'financials',             volRegime: 'mid', primaryListing: tuningPrimaryListing('COF'),   activelyTraded: true,  rationale: 'Consumer credit cycle, charge-off trends, distinct from JPM' },
  { symbol: 'XOM',   watchlist: 'cyclicals_macro', sector: 'energy',                 volRegime: 'mid', primaryListing: tuningPrimaryListing('XOM'),   activelyTraded: false, rationale: 'Energy/commodity-driven, macro regime' },
  { symbol: 'LLY',   watchlist: 'cyclicals_macro', sector: 'healthcare',             volRegime: 'mid', primaryListing: tuningPrimaryListing('LLY'),   activelyTraded: false, rationale: 'GLP-1 momentum cohort, healthcare regime' },
  { symbol: 'NFLX',  watchlist: 'cyclicals_macro', sector: 'communication_services', volRegime: 'mid', primaryListing: tuningPrimaryListing('NFLX'),  activelyTraded: false, rationale: 'Streaming/content, sub/ad-tier earnings binary' },
  { symbol: 'COST',  watchlist: 'cyclicals_macro', sector: 'consumer_staples',       volRegime: 'low', primaryListing: tuningPrimaryListing('COST'),  activelyTraded: false, rationale: 'Defensive consumer, slow vol, no-trade canary for strategist' },
];

export const WATCHLIST_LABELS: Record<TuningWatchlist, string> = {
  mega_cap_core: 'Mega Cap Core',
  active_trade: 'Active Trade Names',
  cyclicals_macro: 'Cyclicals & Macro',
};

export const WATCHLIST_DESCRIPTIONS: Record<TuningWatchlist, string> = {
  mega_cap_core: 'Huge options chains. Threshold-calibration testbed.',
  active_trade: 'Names actively deployed on. Highest signal-to-conviction ratio.',
  cyclicals_macro: 'Different regime archetypes. Earnings-cycle focused.',
};

export const TUNING_SYMBOLS: string[] = TUNING_UNIVERSE.map((e) => e.symbol);

export function getSymbolsByWatchlist(watchlist: TuningWatchlist): string[] {
  return TUNING_UNIVERSE.filter((e) => e.watchlist === watchlist).map((e) => e.symbol);
}

export function getEntryBySymbol(symbol: string): TuningUniverseEntry | undefined {
  return TUNING_UNIVERSE.find((e) => e.symbol === symbol);
}

export function getActivelyTradedSymbols(): string[] {
  return TUNING_UNIVERSE.filter((e) => e.activelyTraded).map((e) => e.symbol);
}

export const SYMBOL_TO_WATCHLIST: Readonly<Record<string, TuningWatchlist>> = Object.freeze(
  TUNING_UNIVERSE.reduce<Record<string, TuningWatchlist>>((acc, e) => {
    acc[e.symbol] = e.watchlist;
    return acc;
  }, {}),
);

export const WATCHLIST_SIZES: Record<TuningWatchlist, number> = {
  mega_cap_core: getSymbolsByWatchlist('mega_cap_core').length,
  active_trade: getSymbolsByWatchlist('active_trade').length,
  cyclicals_macro: getSymbolsByWatchlist('cyclicals_macro').length,
};

const EXPECTED_SIZE = 22;
const EXPECTED_WATCHLIST_SIZES: Record<TuningWatchlist, number> = {
  mega_cap_core: 8,
  active_trade: 8,
  cyclicals_macro: 6,
};

if (TUNING_UNIVERSE.length !== EXPECTED_SIZE) {
  throw new Error(
    `tuningUniverse: expected ${EXPECTED_SIZE} entries, got ${TUNING_UNIVERSE.length}. If intentional, update EXPECTED_SIZE.`,
  );
}

for (const [wl, expected] of Object.entries(EXPECTED_WATCHLIST_SIZES) as [TuningWatchlist, number][]) {
  const actual = WATCHLIST_SIZES[wl];
  if (actual !== expected) {
    throw new Error(
      `tuningUniverse: watchlist '${wl}' expected ${expected} entries, got ${actual}. If intentional, update EXPECTED_WATCHLIST_SIZES.`,
    );
  }
}

const _seenSymbols = new Set<string>();
for (const entry of TUNING_UNIVERSE) {
  if (_seenSymbols.has(entry.symbol)) {
    throw new Error(`tuningUniverse: duplicate symbol ${entry.symbol}`);
  }
  _seenSymbols.add(entry.symbol);
}
