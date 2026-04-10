export interface RunContext {
  passName: string;
  timestamp: string;
}

export interface ActiveIdeasSummary {
  activeCount: number;
  symbols: string[];
  sectors: string[];
}

export interface AnalystRequest {
  symbol: string;
  runContext: RunContext;
  tickerSnapshot: Record<string, unknown>;
  regimeState: Record<string, unknown>;
  patternPerformance: Record<string, unknown> | null;
  activeIdeasSummary: ActiveIdeasSummary;
  baselinesSummary: Record<string, unknown> | null;
}

export interface TradeIdeaCore {
  direction: "LONG" | "SHORT";
  instrumentType: "STOCK" | "OPTIONS" | "STOCK+OPTIONS";
  optionStructureType?: string | null;
  legs?: Array<{
    legType: "CALL" | "PUT";
    side: "BUY" | "SELL";
    strike: number;
    expiration: string;
    quantity: number;
  }> | null;
  entryZone: { min: number; max: number } | null;
  softStop: number | null;
  targetZone: { min: number; max: number } | null;
  timeHorizon: "INTRADAY" | "1-3D" | "3-10D" | "10+D";
}

export interface Rationale {
  thesis: string;
  catalyst: "FLOW" | "EARNINGS" | "TECHNICAL" | "MACRO" | "OTHER";
  invalidation: string;
  regimeFit: "GOOD" | "NEUTRAL" | "POOR";
  mainSignals: string[];
}

export interface Confidence {
  signalStrength: number;
  convictionLevel: "LOW" | "MEDIUM" | "HIGH";
  uncertainty: {
    dataQuality: "HIGH" | "MEDIUM" | "LOW";
    patternReliability?: number | null;
    regimeFitScore?: number | null;
  };
}

export interface LiquiditySnapshot {
  entrySpreadPct?: number | null;
  oiAtEntry?: number | null;
  volumeAtEntry?: number | null;
  volumeToOiRatio?: number | null;
}

export interface ScannerAlignmentAtCreation {
  discoveryScore: number | null;
  momentumScore: number | null;
  modeAlignment: "AGREE" | "DISAGREE" | "NO_SIGNAL" | null;
}

export interface AnalystResponse {
  tradeIdeaCore: TradeIdeaCore;
  rationale: Rationale;
  confidence: Confidence;
  liquiditySnapshot: LiquiditySnapshot;
  scannerAlignmentAtCreation: ScannerAlignmentAtCreation;
  analystNote: string;
}

export interface SkepticRequest {
  symbol: string;
  runContext: RunContext;
  tickerSnapshot: Record<string, unknown>;
  regimeState: Record<string, unknown>;
  candidateIdea: AnalystResponse;
}

export interface SkepticFlags {
  liquidityConcern: boolean;
  regimeMismatch: boolean;
  overfitWarning: boolean;
  redundancyWithActiveIdeas: boolean;
}

export interface SkepticResponse {
  critiqueScore: number;
  flags: SkepticFlags;
  criticNote: string;
}

export interface AiLabAnalystClient {
  generateIdea(request: AnalystRequest): Promise<AnalystResponse>;
  readonly modelName: string;
}

export interface AiLabSkepticClient {
  critiqueIdea(request: SkepticRequest): Promise<SkepticResponse>;
  readonly modelName: string;
}
