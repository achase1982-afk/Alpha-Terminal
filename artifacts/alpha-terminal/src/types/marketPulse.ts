export type BiasDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type MacroRegime = "RISK-ON" | "RISK-OFF" | "NEUTRAL" | "DETERIORATING" | "RECOVERING";

export interface PulseBias {
  direction: BiasDirection;
  confidence: ConfidenceLevel;
  regime: MacroRegime;
  headline: string;
}

export interface PulseCluster {
  id: string;
  category: "equity" | "volatility" | "breadth" | "macro" | "futures" | "commodities";
  title: string;
  bias: BiasDirection;
  confidence: ConfidenceLevel;
  summary: string;
  keyData: Array<{ label: string; value: string; direction?: "up" | "down" | "flat" }>;
}

export interface PulseActionPlan {
  primaryTrade: string;
  direction: BiasDirection;
  instrument: string;
  entry: string;
  stop: string;
  target: string;
  rationale: string;
  alternativePlays: string[];
}

export interface PulseInvalidation {
  conditions: string[];
  keyLevels: Array<{ instrument: string; level: string; significance: string }>;
}

export interface MarketPulseData {
  bias: PulseBias;
  clusters: PulseCluster[];
  actionPlan: PulseActionPlan;
  invalidation: PulseInvalidation;
  session: string;
  timeET: string;
  instrumentCount: number;
  generatedAt: number;
}

export interface MarketPulseSettings {
  autoRefresh: boolean;
  autoRefreshInterval: number;
  riskTolerance: "conservative" | "moderate" | "aggressive";
  preferredInstruments: string[];
  showBiasStrip: boolean;
}
