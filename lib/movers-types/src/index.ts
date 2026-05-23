export { MOVERS_POLL_INTERVAL_MS, MOVERS_MANUAL_REFRESH_DEBOUNCE_MS } from "./constants.js";

export interface MoversFeed {
  capturedAt: string;
  funnel: { detected: number; filtered: number; tradeable: number; situations: number };
  situations: Situation[];
  flagged: FlaggedName[];
  filtered: FilteredName[];
}

export interface Situation {
  kind: "cluster" | "single";
  id: string;
  label: string;
  tickers: TickerStat[];
  catalystType: "GOV" | "ANALYST" | "CONTRACT" | "EARNINGS" | "MA" | "SECTOR" | "NONE" | "PENDING";
  catalyst: string | null;
  read: string | null;
  posture: "WATCH" | "WAIT" | "PASS" | "PENDING";
  confidence: "HIGH" | "MED" | "LOW" | null;
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
