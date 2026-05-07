/** Shared types for Strategist Desk result (card, speech, copy). */

export interface DeskKeyStrike {
  strike: number;
  expiry: string;
  type: string;
  observation: string;
}

export interface DeskLeg {
  type: string;
  strike: number;
  action: string;
  expiration: string;
  quantity?: number;
}

export interface DeskStructure {
  type: string;
  legs: DeskLeg[];
  expiry: string;
  credit_or_debit: number;
}

export interface PayoffScenario {
  underlyingPrice: number;
  spreadValue: number;
  pnl: number;
  pnlColor: "green" | "red" | "neutral";
}

export interface PayoffScenariosSummary {
  peakPnl: number;
  peakPnlPrice: number;
  profitZoneLow: number | null;
  profitZoneHigh: number | null;
  upsideBreakdown: number | null;
  downsideBreakdown: number | null;
}

export interface VolAnalystOutput {
  iv_state: string;
  term_structure: string;
  skew: string;
  implied_vs_realized: string;
  read: string;
}

export interface FlowAnalystOutput {
  dominant_flow: string;
  institutional_signal: string;
  retail_signal: string;
  key_strikes: DeskKeyStrike[];
  read: string;
}

export interface CatalystAnalystOutput {
  primary_catalyst: string;
  bar_to_clear: string;
  asymmetry: string;
  historical_pattern: string;
  read: string;
}

export interface DeskExitPlan {
  profit_target: number;
  stop_loss: number;
  time_stop: string;
}

export interface PmOutput {
  decision: "trade" | "pass";
  structure: DeskStructure | null;
  thesis: string;
  edge_check?: string;
  deviation_from_analysts?: string;
  size: "small" | "medium" | "large";
  whose_side: "institutional_alignment" | "retail_fade" | "neither";
  biggest_risk: string;
  exit_plan: DeskExitPlan;
  watch_for: string;
  /** Server-computed payoff grid; null when not available. */
  scenarios?: PayoffScenario[] | null;
  scenariosSummary?: PayoffScenariosSummary | null;
}

export interface DeskResultClassic {
  mode: "desk" | "solo_desk";
  ticker: string;
  vol: VolAnalystOutput;
  flow: FlowAnalystOutput;
  catalyst: CatalystAnalystOutput;
  pm: PmOutput;
  models: {
    vol: string;
    flow: string;
    catalyst: string;
    pm: string;
  };
  errors?: string[];
  pmOutputIncomplete?: boolean;
  soloDeskJsonDegraded?: "schema_validation_failed_after_retry";
}

export interface ConvictionDeskOutput {
  vol: VolAnalystOutput;
  flow: FlowAnalystOutput;
  catalyst: CatalystAnalystOutput;
  pm: PmOutput;
  regime_synthesis: {
    regime_read:
      | "long_premium"
      | "short_premium"
      | "neutral_premium"
      | "directional_long"
      | "directional_short"
      | "no_edge";
    synthesis: string;
  };
  risk_of_ruin: string;
  positioning_context: {
    crowd_state: "crowded_long" | "crowded_short" | "balanced" | "unclear";
    sell_side_targets_vs_price: string;
    implied_vs_consensus: string;
    fade_risk: string;
  };
  structure_family_discipline: {
    directional_evaluated: string;
    vol_surface_evaluated: string;
    premium_evaluated: string;
    chosen_family: "directional" | "vol_surface" | "premium" | "no_trade";
    defense: string;
  };
}

export interface ConvictionDeskResult {
  mode: "conviction_desk";
  ticker: string;
  conviction: ConvictionDeskOutput | null;
  payoffScenarios?: PayoffScenario[] | null;
  payoffSummary?: PayoffScenariosSummary | null;
  models: DeskResultClassic["models"];
  errors?: string[];
  convictionDeskJsonDegraded?: "schema_validation_failed_after_retry" | "stream_error" | "extraction_error";
}

/** Desk recommendation payload: classic four-topic desk or Conviction memo JSON. */
export type DeskResult = DeskResultClassic | ConvictionDeskResult;
