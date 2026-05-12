import type { UnifiedScanCandidate } from "@/lib/unifiedScanTypes";

export type UnifiedScanPhase = "idle" | "scanning" | "complete" | "error";

export interface V2ScanResponse {
  candidates: UnifiedScanCandidate[];
  snapshot_completed_at: string | null;
  snapshot_age_seconds: number | null;
  stale: boolean | null;
  scan_at: string;
  tuning_watchlist?: "mega_cap_core" | "active_trade" | "cyclicals_macro";
}

/** Layer 2 Schwab batch quote merge — same order as `tickers`. */
export interface ScannerV3WireCard {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  change_abs: number | null;
  change_pct: number | null;
  volume: number | null;
  avg_volume_20d: number | null;
  day_range: { low: number; high: number } | null;
  iv30?: number | null;
  ivr?: number | null;
  hv30?: number | null;
  iv_vs_hv?: number | null;
  next_earnings_date?: string | null;
  earnings_timing_hint?: "BMO" | "AMC" | null;
  days_to_earnings?: number | null;
  next_ex_dividend_date?: string | null;
  ex_dividend_amount?: number | null;
  days_to_ex_dividend?: number | null;
  reactions_last_4q?: number[] | null;
  flow?: ScannerV3WireCardFlow | null;
  technical?: ScannerV3WireCardTechnical | null;
  score?: number | null;
  score_components?: {
    liquidity: number | null;
    vol_context: number | null;
    catalyst: number | null;
    flow: number | null;
    technical: number | null;
  } | null;
  matched_preset?: string | null;
}

export type ScannerV3WireCardTechnical = {
  fifty_two_week_low: number | null;
  fifty_two_week_high: number | null;
  off_fifty_two_week_high_pct: number | null;
  vs_twenty_ma_pct: number | null;
  vs_fifty_ma_pct: number | null;
  vs_two_hundred_ma_pct: number | null;
  five_day_return_pct: number | null;
  thirty_day_return_pct: number | null;
};

export type ScannerV3WireCardFlow = {
  blocks_4h: number | null;
  sweeps_4h: number | null;
  net_delta_dollar: number | null;
  top_strike_label: string | null;
  top_strike: {
    strike: number;
    option_type: "call" | "put";
    expiration: string;
    volume_at_strike: number;
    open_interest: number | null;
  } | null;
  volume_4h: number | null;
  volume_over_oi: number | null;
  events_today: number | null;
  primary_event_type: "sweep" | "block" | null;
  net_direction: "bullish" | "bearish" | "mixed" | "neutral";
  last_event_ts: string | null;
  sweep_count: number | null;
  block_count: number | null;
  largest_event_notional: number | null;
};

export type ScannerUaiMoneynessBucket = "deep_itm" | "itm" | "atm" | "otm" | "deep_otm";

/** GET /api/scanner/v3/symbol/:symbol/events — one persisted print, UAI-shaped. */
export type ScannerUaiEventWire = {
  id: number;
  ts: string;
  optionSymbol: string;
  callPut: "C" | "P";
  strike: number;
  expiration: string;
  dte: number;
  moneynessBucket: ScannerUaiMoneynessBucket;
  is0dte: boolean;
  side: "ask" | "bid" | "mid" | null;
  aggressorConfidence: number | null;
  isSweep: boolean;
  isBlock: boolean;
  contracts: number;
  notional: number;
  tradePrice: number;
  volOiRatio: number | null;
  openInterestSnapshot: number | null;
  volumeVsBaseline20d: number | null;
  direction: "bullish" | "bearish" | "neutral";
  syntheticLegGroupId: string | null;
  multiLegConfidence: "high" | "medium" | "low" | null;
  multiLegPartnerOcc: string | null;
  nbboPositionLabel: string;
};

export type ScannerUaiEventsSummaryWire = {
  totalEvents: number;
  bullishNotional: number;
  bearishNotional: number;
  netDeltaDollar: number | null;
  topBullishStrikes: Array<{ strike: number; expiration: string; callPut: "C" | "P"; notional: number }>;
  topBearishStrikes: Array<{ strike: number; expiration: string; callPut: "C" | "P"; notional: number }>;
  callNotional: number;
  putNotional: number;
};

export interface ScannerV3SymbolEventsResponse {
  symbol: string;
  windowMs: number;
  events: ScannerUaiEventWire[];
  summary: ScannerUaiEventsSummaryWire;
}

export interface ScannerV3UniverseResponse {
  tickers: string[];
  scan_at: string;
  count: number;
  universe?: string;
  cards?: ScannerV3WireCard[];
  schwab_access_token_present?: boolean;
  layer2_quote_hits?: number;
  layer3_iv30_hits?: number;
  layer3_hv30_hits?: number;
  layer3_ivr_hits?: number;
  layer4_earnings_hits?: number;
  layer4_ex_div_hits?: number;
  layer4_reactions_hits?: number;
  layer5_flow_hits?: number;
  layer5_flow_window_ms?: number;
  layer5_flow_cutoff_iso?: string;
  layer5_flow_rows_in_window?: number;
  layer5_flow_max_trade_ts_in_window?: string | null;
  layer6_technical_hits?: number;
}

export interface UseUnifiedScanState {
  phase: UnifiedScanPhase;
  candidates: UnifiedScanCandidate[];
  snapshotCompletedAt: string | null;
  snapshotAgeSeconds: number | null;
  stale: boolean | null;
  scanAt: string | null;
  tuningWatchlistEcho: V2ScanResponse["tuning_watchlist"];
  errorMessage: string | null;
  layer1Universe: ScannerV3UniverseResponse | null;
  startScan: (universeId: string) => Promise<void>;
  cancelLocal: () => void;
}
