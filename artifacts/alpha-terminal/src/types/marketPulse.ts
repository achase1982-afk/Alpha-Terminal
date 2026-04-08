export type PulseBias = "STRONGLY_BULLISH" | "MODERATELY_BULLISH" | "SLIGHTLY_BULLISH" | "NEUTRAL" | "SLIGHTLY_BEARISH" | "MODERATELY_BEARISH" | "STRONGLY_BEARISH" | "NO_EDGE" | "ERROR";
export type DataQuality = "FRESH" | "STALE" | "MISSING";
export type RatesDirection = "UP" | "DOWN" | "FLAT";
export type CreditDirection = "UP" | "DOWN" | "FLAT";
export type VolDirection = "COMPRESSING" | "EXPANDING" | "STABLE" | "FLAT";
export type TermStructureDirection = "CONTANGO" | "FLAT" | "INVERTED";
export type BreadthDirection = "BROAD_PARTICIPATION" | "BROAD_DETERIORATION" | "MIXED" | "POSITIVE" | "NEGATIVE" | "FLAT";
export type RiskAppDirection = "POSITIVE" | "NEGATIVE" | "FLAT";
export type MacroDirection = "POSITIVE" | "NEGATIVE" | "FLAT";
export type ClusterDirection = RatesDirection | CreditDirection | VolDirection | TermStructureDirection | BreadthDirection | RiskAppDirection | MacroDirection;
export type RegimeLabel = "RISK_ON" | "RISK_OFF" | "TRANSITION" | "NO_READ";
export type SessionBiasLabel = "BULLISH" | "BEARISH" | "NEUTRAL" | "NO_EDGE";
export type RiskStateLabel = "PRESS" | "NORMAL" | "REDUCED" | "NO_TRADE";
export type RiskPosture = "FULL" | "REDUCED" | "QUARTER" | "NO_TRADE";
export type Conviction = "HIGH" | "MODERATE" | "LOW";
export type TodayEdge = "BULLISH_EDGE" | "BEARISH_EDGE" | "NEUTRAL_EDGE" | "NO_EDGE";
export type SizeRecommendation = "FULL_SIZE" | "HALF_SIZE" | "NO_TRADE";
export type MomentumLabel = "ACCELERATING" | "IMPROVING" | "STABLE" | "FADING" | "DETERIORATING" | "FIRST_READ" | "STALE_COMPARISON" | "SESSION_GAP";

export type IVDirection = "SELL_PREMIUM" | "NEUTRAL_IV" | "BUY_PREMIUM";
export type BroadSentiment = "EXTREME_FEAR" | "ELEVATED_FEAR" | "NEUTRAL" | "EXTREME_GREED";
export type InstitutionalHedging = "INSTITUTIONS_HEDGING_HARD" | "INSTITUTIONS_HEDGING" | "INSTITUTIONAL_NEUTRAL" | "INSTITUTIONS_COMPLACENT";

export interface ClusterData {
  score: number;
  raw?: number;
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
  volTerm: ClusterData;
  breadth: ClusterData;
  riskAppetite: ClusterData;
  macro: ClusterData;
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

export interface BreadthDetail {
  nyseScore: number;
  nasdaqScore: number;
  exchangeDivergence: boolean;
}

export interface MomentumData {
  delta: number | null;
  label: MomentumLabel;
  previousComposite: number | null;
  previousTimestamp: string | null;
  timeDeltaMinutes: number | null;
}

export interface OptionsLayer {
  ivRank: number | null;
  premiumDirection: IVDirection | null;
  broadSentiment: BroadSentiment | null;
  institutionalHedging: InstitutionalHedging | null;
  tickerFlags: string[];
  avoidShortPremium: boolean;
  avoidReason: string | null;
  tradeTypeRecommendation: string;
}

export interface DataQualitySummary {
  freshCount: number;
  staleCount: number;
  missingCount: number;
  missingClusters: string[];
  staleClusters: string[];
  experimentalAvailable: Record<string, boolean>;
}

export interface RawIndicators {
  vix: number | null;
  vixChange: number | null;
  vvix: number | null;
  vvixChange: number | null;
  vix1d: number | null;
  vix1dChange: number | null;
  vix3m: number | null;
  vix3mChange: number | null;
  vix9d: number | null;
  vix9dChange: number | null;
  vxn: number | null;
  vxnChange: number | null;
  rvx: number | null;
  rvxChange: number | null;
  ovx: number | null;
  ovxChange: number | null;
  gvz: number | null;
  gvzChange: number | null;
  vixFut: number | null;
  vixFutChange: number | null;

  tnx: number | null;
  tnxChange: number | null;
  tyx: number | null;
  tyxChange: number | null;
  irx: number | null;
  irxChange: number | null;
  zb: number | null;
  zbChange: number | null;
  zt: number | null;
  ztChange: number | null;
  zf: number | null;
  zfChange: number | null;
  zn: number | null;
  znChange: number | null;
  zq: number | null;
  zqChange: number | null;

  hyg: number | null;
  hygChange: number | null;
  lqd: number | null;
  lqdChange: number | null;
  ief: number | null;
  iefChange: number | null;
  tlt: number | null;
  tltChange: number | null;

  advn: number | null;
  decn: number | null;
  tick: number | null;
  trin: number | null;
  add: number | null;
  uvol: number | null;
  dvol: number | null;
  ticki: number | null;
  trinq: number | null;
  addq: number | null;
  advnq: number | null;
  decnq: number | null;
  uvolq: number | null;
  dvolq: number | null;

  es: number | null;
  esChange: number | null;
  nq: number | null;
  nqChange: number | null;
  ym: number | null;
  ymChange: number | null;
  rty: number | null;
  rtyChange: number | null;
  spy: number | null;
  spyChange: number | null;
  qqq: number | null;
  qqqChange: number | null;
  iwm: number | null;
  iwmChange: number | null;

  gc: number | null;
  gcChange: number | null;
  cl: number | null;
  clChange: number | null;
  hg: number | null;
  hgChange: number | null;
  dx: number | null;
  dxChange: number | null;
  sixE: number | null;
  sixEChange: number | null;
  sixJ: number | null;
  sixJChange: number | null;

  cpce: number | null;
  cpci: number | null;
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
  divergenceDetail?: { bullishClusters: string[]; bearishClusters: string[] };
  secondaryFlags?: string[];
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
    reasoning?: string[];
  };
  shockState?: "NORMAL" | "WARNING" | "ACTIVE" | "COOLING";
  activeTriggers?: Array<{
    trigger: string;
    value: number;
    threshold: number;
    firedAt: number;
  }>;
  shockActivatedAt?: number | null;
  shockActive?: boolean;
  todayEdge?: TodayEdge;
  sizeRecommendation?: SizeRecommendation;
  invalidation: string[] | {
    conditions: string[];
  };
  levelsToWatch: LevelToWatch[];
  actionPlan: ActionPlanItem[];
  breadthDetail?: BreadthDetail;
  momentum?: MomentumData;
  optionsLayer?: OptionsLayer;
  riskStateReasoning?: string[];
  dataQuality?: DataQualitySummary;
  weights?: Record<string, number>;
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

export type PulseIndicatorCategory = "volatility" | "breadth" | "rates" | "credit" | "futures" | "commodities" | "currency" | "options";

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
  currency: "Currency / FX",
  options: "Options Flow",
};

export const ALL_PULSE_INDICATORS: PulseIndicator[] = [
  { symbol: "$VIX",    label: "VIX (30-Day Implied Vol)",       category: "volatility" },
  { symbol: "$VVIX",   label: "VVIX (Vol of Vol)",              category: "volatility" },
  { symbol: "$VIX1D",  label: "VIX1D (1-Day VIX)",             category: "volatility" },
  { symbol: "$VIX9D",  label: "VIX9D (9-Day VIX)",             category: "volatility" },
  { symbol: "$VIX3M",  label: "VIX3M (3-Month VIX)",           category: "volatility" },
  { symbol: "$VXN",    label: "VXN (Nasdaq VIX)",              category: "volatility" },
  { symbol: "$RVX",    label: "RVX (Russell VIX)",             category: "volatility" },
  { symbol: "$OVX",    label: "OVX (Oil VIX)",                 category: "volatility" },
  { symbol: "$GVZ",    label: "GVZ (Gold VIX)",                category: "volatility" },
  { symbol: "/VIX",    label: "/VIX (VIX Futures)",            category: "volatility" },

  { symbol: "$TICK",   label: "TICK (NYSE Tick)",               category: "breadth" },
  { symbol: "$ADD",    label: "ADD (A/D Line)",                 category: "breadth" },
  { symbol: "$ADVN",   label: "ADVN (Advancers)",              category: "breadth" },
  { symbol: "$DECN",   label: "DECN (Decliners)",              category: "breadth" },
  { symbol: "$TRIN",   label: "TRIN (Arms Index)",             category: "breadth" },
  { symbol: "$UVOL",   label: "UVOL (Up Volume)",              category: "breadth" },
  { symbol: "$DVOL",   label: "DVOL (Down Volume)",            category: "breadth" },
  { symbol: "$TICKI",  label: "TICKI (NASDAQ Tick)",           category: "breadth" },
  { symbol: "$ADDQ",   label: "ADDQ (NASDAQ A/D)",            category: "breadth" },
  { symbol: "$ADVNQ",  label: "ADVNQ (NASDAQ Advancers)",     category: "breadth" },
  { symbol: "$DECNQ",  label: "DECNQ (NASDAQ Decliners)",     category: "breadth" },
  { symbol: "$TRINQ",  label: "TRINQ (NASDAQ TRIN)",          category: "breadth" },
  { symbol: "$UVOLQ",  label: "UVOLQ (NASDAQ Up Volume)",     category: "breadth" },
  { symbol: "$DVOLQ",  label: "DVOLQ (NASDAQ Down Volume)",   category: "breadth" },

  { symbol: "$TNX",    label: "TNX (10Y Yield)",               category: "rates" },
  { symbol: "$TYX",    label: "TYX (30Y Yield)",               category: "rates" },
  { symbol: "$IRX",    label: "IRX (13W T-Bill Yield)",        category: "rates" },
  { symbol: "/ZB",     label: "/ZB (30Y Bond Futures)",        category: "rates" },
  { symbol: "/ZT",     label: "/ZT (2Y Note Futures)",         category: "rates" },
  { symbol: "/ZF",     label: "/ZF (5Y Note Futures)",         category: "rates" },
  { symbol: "/ZN",     label: "/ZN (10Y Note Futures)",        category: "rates" },
  { symbol: "/ZQ",     label: "/ZQ (Fed Funds Futures)",       category: "rates" },

  { symbol: "HYG",     label: "HYG (High Yield Corp Bonds)",   category: "credit" },
  { symbol: "LQD",     label: "LQD (Investment Grade Bonds)",  category: "credit" },
  { symbol: "IEF",     label: "IEF (7-10Y Treasury ETF)",      category: "credit" },
  { symbol: "TLT",     label: "TLT (20+ Year Treasury ETF)",   category: "credit" },

  { symbol: "/ES",     label: "/ES (S&P 500 Futures)",         category: "futures" },
  { symbol: "/NQ",     label: "/NQ (Nasdaq Futures)",          category: "futures" },
  { symbol: "/YM",     label: "/YM (Dow Futures)",             category: "futures" },
  { symbol: "/RTY",    label: "/RTY (Russell 2000 Futures)",   category: "futures" },

  { symbol: "/GC",     label: "/GC (Gold Futures)",            category: "commodities" },
  { symbol: "/CL",     label: "/CL (Crude Oil Futures)",       category: "commodities" },
  { symbol: "/HG",     label: "/HG (Copper Futures)",          category: "commodities" },

  { symbol: "/DX",     label: "/DX (Dollar Index Futures)",    category: "currency" },
  { symbol: "/6E",     label: "/6E (Euro FX Futures)",         category: "currency" },
  { symbol: "/6J",     label: "/6J (Yen Futures)",             category: "currency" },

  { symbol: "$PCUSEQTR", label: "Equity Put/Call (PCUSEQTR)",  category: "options" },
  { symbol: "$PCUSINXR", label: "Index Put/Call (PCUSINXR)",   category: "options" },
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
