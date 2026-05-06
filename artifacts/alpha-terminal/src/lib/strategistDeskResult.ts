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

export interface ConvictionOutcomeDistribution {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface ConvictionGreeksEntry {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  front_vega?: number;
  back_vega?: number;
}

export interface ConvictionGreeksEvolutionCell {
  stock_path: "+1σ" | "0" | "-1σ";
  days_held: 1 | 3 | "expiry-eve";
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
}

export interface ConvictionChosenStructure {
  structure: string;
  legs: unknown[];
  expiry: string;
  credit_or_debit: number;
  greeks_entry: ConvictionGreeksEntry;
  greeks_evolution: ConvictionGreeksEvolutionCell[];
  outcome_distribution: ConvictionOutcomeDistribution;
  ev_dollars: number;
  max_loss: number;
  stop_loss?: number;
}

export interface ConvictionDeskOutput {
  regime: {
    summary: string;
    vol: string;
    sector: string;
    macro: string;
    stock: string;
    holding_period_window: string;
    indicators: Record<string, number | null>;
  };
  view: {
    paragraph: string;
    decision_intent: "trade" | "pass";
  };
  decision: {
    candidates_considered: Array<{
      structure: string;
      legs: unknown[];
      debit_credit: number;
      greeks_entry: ConvictionGreeksEntry;
      max_profit: number;
      max_loss: number;
      breakevens: number[];
      outcome_distribution: ConvictionOutcomeDistribution;
      ev_dollars: number;
      regime_fit: "fits" | "neutral" | "fights";
      regime_fit_reasoning: string;
    }>;
    chosen: ConvictionChosenStructure | null;
    rejected_alternatives: Array<{ structure: string; reason: string }>;
  };
  failure_scenario: {
    steelman: string;
    response: string;
    sufficient: boolean;
  };
  scenarios: {
    designed: {
      description: string;
      trade_value_path: string;
      greek_changes: string;
      pnl_per_spread: number;
    };
    adverse_bounded: {
      description: string;
      trade_value_path: string;
      greek_changes: string;
      pnl_per_spread: number;
      stop_trigger: string;
    };
    tail: {
      description: string;
      trade_value_path: string;
      pnl_per_spread: number;
    };
  } | null;
  exit_plan: {
    profit_take: Array<{ level: string; scale_out_pct: number }>;
    vol_trigger: string | null;
    price_trigger: string | null;
    time_stop: string;
  } | null;
  self_grade: {
    vol: string;
    flow: string;
    catalyst: string;
    regime: string;
    structure_fit: string;
    failure_scenario_strength: string;
    conviction: string;
    conviction_threshold_met: boolean;
  };
  size: "small" | "medium" | "large" | "no-trade";
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
