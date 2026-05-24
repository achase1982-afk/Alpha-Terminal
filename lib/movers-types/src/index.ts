export {
  MARKET_CAP_FLOOR,
  MOVERS_MANUAL_REFRESH_DEBOUNCE_MS,
  MOVERS_POLL_INTERVAL_MS,
} from "./constants.js";
export { MOVERS_THEME_TICKER_MAP } from "./themeTickers.js";
export {
  MOVERS_CATALYST_KEYWORD_GROUPS,
  classifyCatalystTypeFromHeadline,
  headlineMatchesKeyword,
} from "./catalystKeywords.js";

export interface MoversFeed {
  capturedAt: string;
  funnel: { detected: number; filtered: number; tradeable: number; situations: number };
  situations: Situation[];
  flagged: FlaggedName[];
  filtered: FilteredName[];
}

export type MoversCatalystType =
  | "GOV"
  | "ANALYST"
  | "CONTRACT"
  | "EARNINGS"
  | "MA"
  | "SECTOR"
  | "UNKNOWN"
  | "NONE";

export type MoversPosture = "WATCH" | "WAIT" | "PASS";

export type MoversConfidence = "HIGH" | "MED" | "LOW";

export interface Situation {
  kind: "cluster" | "single";
  id: string;
  label: string;
  tickers: TickerStat[];
  /** Deterministic keyword classification from driving headline. */
  catalystType: MoversCatalystType;
  /** Most recent relevant FMP headline (catalyst summary). */
  catalyst: string;
  /** Cache key from driving news; empty when type is NONE. */
  newsKey: string;
}

/** Lazy-generated on GET /api/movers/read (not included in feed payload). */
export interface MoversSituationRead {
  read: string;
  posture: MoversPosture;
  confidence: MoversConfidence;
  cached?: boolean;
}

export interface TickerStat {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  changePct: number;
  sector?: string;
  industry?: string;
  marketCap?: number;
  description?: string;
}

export interface FilteredName {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  reason: "LEVERAGED_ETF" | "SUB_5" | "MICRO_CAP";
}

export interface FlaggedName {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  note: string;
}
