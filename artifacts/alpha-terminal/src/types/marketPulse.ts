export type PulseBias = "STRONGLY_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONGLY_BEARISH" | "NO_EDGE" | "ERROR";
export type DataQuality = "FRESH" | "STALE" | "MISSING";
export type RatesDirection = "UP" | "DOWN" | "FLAT";
export type CreditDirection = "UP" | "DOWN" | "FLAT";
export type VolDirection = "COMPRESSING" | "EXPANDING" | "FLAT";
export type TermStructureDirection = "CONTANGO" | "FLAT" | "INVERTED";
export type BreadthDirection = "POSITIVE" | "NEGATIVE" | "FLAT";
export type ClusterDirection = RatesDirection | CreditDirection | VolDirection | TermStructureDirection | BreadthDirection;
export type RegimeLabel = "RISK_ON" | "RISK_OFF" | "TRANSITION" | "NO_READ";
export type SessionBiasLabel = "BULLISH" | "BEARISH" | "NEUTRAL" | "NO_EDGE";
export type RiskStateLabel = "PRESS" | "NORMAL" | "REDUCED" | "NO_TRADE";
export type RiskPosture = "FULL" | "REDUCED" | "QUARTER" | "NO_TRADE";
export type Conviction = "HIGH" | "MODERATE" | "LOW";

export interface ClusterData {
  score: number;
  dataQuality: DataQuality;
  direction: ClusterDirection;
  headline: string;
  keyDataPoints: string[];
  rulesApplied?: string[];
}

export interface MarketPulseClusters {
  rates: ClusterData;
  credit: ClusterData;
  volLevel: ClusterData;
  volTermStructure: ClusterData;
  breadth: ClusterData;
}

export type ClusterKey = keyof MarketPulseClusters;

export interface LevelToWatch {
  symbol: string;
  level: number;
  direction: "ABOVE" | "BELOW";
  significance: string;
}

export interface ActionPlanItem {
  condition: string;
  strategy: string;
  rationale: string;
  riskPosture: RiskPosture;
  conviction: Conviction;
}

export interface RawIndicators {
  vix: number | null;
  vixChange: number | null;
  vvix: number | null;
  vvixChange: number | null;
  vix3m: number | null;
  vix3mChange: number | null;
  vix9d: number | null;
  vix9dChange: number | null;
  skew: number | null;
  tnx: number | null;
  tnxChange: number | null;
  tyx: number | null;
  tyxChange: number | null;
  hyg: number | null;
  hygChange: number | null;
  lqd: number | null;
  lqdChange: number | null;
  ief: number | null;
  iefChange: number | null;
  nyicdx: number | null;
  nyicdxChange: number | null;
  advn: number | null;
  decn: number | null;
  tick: number | null;
  trin: number | null;
  add: number | null;
  uvol: number | null;
  dvol: number | null;
}

export interface MarketPulseData {
  timestamp: string;
  engineVersion?: string;
  rawIndicators?: RawIndicators;
  dataAge: {
    oldestSource: string;
    oldestSourceAge: number;
  };
  bias: PulseBias;
  compositeScore: number;
  confidenceScore: number;
  maxConfidence: number;
  hasDivergence: boolean;
  divergenceNote: string | null;
  clusters: MarketPulseClusters;
  structuralRegime: {
    label: RegimeLabel;
    timeframe: string;
    summary: string;
  };
  sessionBias: {
    label: SessionBiasLabel;
    summary: string;
  };
  riskState: {
    label: RiskStateLabel;
    reason: string;
  };
  invalidation: string[] | {
    conditions: string[];
  };
  levelsToWatch: LevelToWatch[];
  actionPlan: ActionPlanItem[];
  session: string;
  timeET: string;
  instrumentCount: number;
  generatedAt: number;
}

export type AllowedStrategy =
  | "verticalSpreads"
  | "debitSpreads"
  | "ironCondors"
  | "calendars"
  | "butterflies"
  | "nakedOptions"
  | "straddles"
  | "coveredCalls"
  | "equity";

export const STRATEGY_LABELS: Record<AllowedStrategy, string> = {
  verticalSpreads: "Vertical Spreads (Bull Put / Bear Call)",
  debitSpreads: "Debit Spreads (Bull Call / Bear Put)",
  ironCondors: "Iron Condors",
  calendars: "Calendars / Diagonals",
  butterflies: "Butterflies",
  nakedOptions: "Naked Options",
  straddles: "Straddles / Strangles",
  coveredCalls: "Covered Calls / Cash-Secured Puts",
  equity: "Equity (long/short shares)",
};

export const ALL_STRATEGIES: AllowedStrategy[] = Object.keys(STRATEGY_LABELS) as AllowedStrategy[];

export type PulseIndicatorCategory = "volatility" | "breadth" | "rates" | "credit" | "futures" | "commodities";

export interface PulseIndicator {
  symbol: string;
  label: string;
  category: PulseIndicatorCategory;
}

export const PULSE_INDICATOR_CATEGORIES: Record<PulseIndicatorCategory, string> = {
  volatility: "Volatility",
  breadth: "Market Breadth",
  rates: "Rates / Treasuries",
  credit: "Credit / Fixed Income",
  futures: "Equity Futures",
  commodities: "Commodities",
};

export const ALL_PULSE_INDICATORS: PulseIndicator[] = [
  { symbol: "$VIX",   label: "VIX (30-Day Implied Vol)",      category: "volatility" },
  { symbol: "$VVIX",  label: "VVIX (Vol of Vol)",             category: "volatility" },
  { symbol: "$VIX9D", label: "VIX9D (9-Day VIX)",            category: "volatility" },
  { symbol: "$VIX3M", label: "VIX3M (3-Month VIX)",          category: "volatility" },
  { symbol: "$SKEW",  label: "SKEW (Tail Risk)",             category: "volatility" },

  { symbol: "$TICK",  label: "TICK (NYSE Tick)",              category: "breadth" },
  { symbol: "$ADD",   label: "ADD (A/D Line)",               category: "breadth" },
  { symbol: "$ADVN",  label: "ADVN (Advancers)",             category: "breadth" },
  { symbol: "$DECN",  label: "DECN (Decliners)",             category: "breadth" },
  { symbol: "$TRIN",  label: "TRIN (Arms Index)",            category: "breadth" },
  { symbol: "$UVOL",  label: "UVOL (Up Volume)",             category: "breadth" },
  { symbol: "$DVOL",  label: "DVOL (Down Volume)",           category: "breadth" },

  { symbol: "$TNX",   label: "TNX (10Y Yield)",              category: "rates" },
  { symbol: "$TYX",   label: "TYX (30Y Yield)",              category: "rates" },
  { symbol: "/ZB",    label: "/ZB (30Y Bond Futures)",       category: "rates" },
  { symbol: "/ZT",    label: "/ZT (2Y Note Futures)",        category: "rates" },
  { symbol: "/ZQ",    label: "/ZQ (Fed Funds Futures)",      category: "rates" },

  { symbol: "HYG",    label: "HYG (High Yield Corp Bonds)",  category: "credit" },
  { symbol: "LQD",    label: "LQD (Investment Grade Bonds)", category: "credit" },
  { symbol: "IEF",    label: "IEF (7-10Y Treasury ETF)",     category: "credit" },
  { symbol: "$HYD",   label: "HYD (High Yield Muni)",        category: "credit" },
  { symbol: "$NYICDX", label: "NYICDX (NY ICE Index)",       category: "credit" },
  { symbol: "$ADSPD", label: "ADSPD (A/D Spread)",           category: "credit" },

  { symbol: "/ES",    label: "/ES (S&P 500 Futures)",        category: "futures" },
  { symbol: "/NQ",    label: "/NQ (Nasdaq Futures)",         category: "futures" },
  { symbol: "/YM",    label: "/YM (Dow Futures)",            category: "futures" },
  { symbol: "/RTY",   label: "/RTY (Russell 2000 Futures)",  category: "futures" },

  { symbol: "/GC",    label: "/GC (Gold Futures)",           category: "commodities" },
  { symbol: "/CL",    label: "/CL (Crude Oil Futures)",      category: "commodities" },
  { symbol: "/BZ",    label: "/BZ (Brent Crude Futures)",    category: "commodities" },
];

export interface MarketPulseSettings {
  showBiasStrip: boolean;
  autoRefresh: boolean;
  autoRefreshInterval: number;
  showActionPlan: boolean;
  showClusterDetails: boolean;
  compactMode: boolean;
  allowedStrategies: AllowedStrategy[];
  defaultSpreadWidth: string;
  maxContracts: string;
  accountSizeTier: string;
  preferredTickers: string;
  maxRiskPerTrade: string;
  allowNoEdgeSuppression: boolean;
  pulseIndicators: string[];
}
