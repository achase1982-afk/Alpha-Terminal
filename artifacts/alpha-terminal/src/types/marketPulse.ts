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

export interface MarketPulseData {
  timestamp: string;
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
}
