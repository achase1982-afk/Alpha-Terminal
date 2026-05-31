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
  /** Card-face distillation of thesis (Solo / Conviction Desk). */
  why_bullets?: string[];
  /** Card-face distillation of risk reasoning (Solo / Conviction Desk). */
  what_kills_bullets?: string[];
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

export type ConvictionFitScore = "high" | "medium" | "low" | "unfit";

export type ConvictionTradeFamilyHypothesis = {
  family: "long_vol" | "short_vol" | "directional";
  candidate_structure: string;
  entry_math: string;
  thesis_this_family_represents: string;
  fit_score: ConvictionFitScore;
  reason_for_score: string;
  what_would_make_it_unfit: string;
};

export type ConvictionPassHypothesis = {
  family: "pass";
  candidate_structure: null;
  entry_math: null;
  thesis_this_family_represents: string;
  fit_score: ConvictionFitScore;
  reason_for_score: string;
  what_would_make_it_unfit: string;
};

export type ConvictionFamilyHypothesisEntry = ConvictionTradeFamilyHypothesis | ConvictionPassHypothesis;

export interface ConvictionDeskOutput {
  vol: VolAnalystOutput;
  flow: FlowAnalystOutput;
  catalyst: CatalystAnalystOutput;
  family_hypotheses: [
    ConvictionTradeFamilyHypothesis & { family: "long_vol" },
    ConvictionTradeFamilyHypothesis & { family: "short_vol" },
    ConvictionTradeFamilyHypothesis & { family: "directional" },
    ConvictionPassHypothesis,
  ];
  regime_synthesis: {
    regime_read:
      | "short_premium_neutral"
      | "short_premium_directional"
      | "long_premium_neutral"
      | "long_premium_directional"
      | "pure_directional_long"
      | "pure_directional_short"
      | "no_edge";
    strongest_hypothesis: "long_vol" | "short_vol" | "directional" | "pass";
    synthesis: string;
  };
  pm: PmOutput;
  risk_of_ruin: string;
  positioning_context: {
    crowd_state: "crowded_long" | "crowded_short" | "balanced" | "unclear";
    sell_side_targets_vs_price: string;
    implied_vs_consensus: string;
    upside_fade_risk: string;
    downside_fade_risk: string;
  };
  self_check: {
    each_family_priced_with_math: boolean;
    each_family_priced_with_math_reason: string;
    decision_consistent_with_strongest_hypothesis: boolean;
    decision_consistent_with_strongest_hypothesis_reason: string;
    call_survives_reverse_family_order: boolean;
    call_survives_reverse_family_order_reason: string;
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

/**
 * Conviction desk payloads from the wire or older cache rows may omit new fields (e.g. family_hypotheses)
 * while still carrying pm/vol/flow/catalyst. Guards rendering and speech builders against partial objects.
 */
export function isConvictionDeskOutputComplete(c: unknown): c is ConvictionDeskOutput {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (!o.pm || typeof o.pm !== "object") return false;
  if (!o.vol || typeof o.vol !== "object") return false;
  if (!o.flow || typeof o.flow !== "object") return false;
  if (!o.catalyst || typeof o.catalyst !== "object") return false;
  const fh = o.family_hypotheses;
  if (!Array.isArray(fh) || fh.length === 0) return false;
  if (!o.regime_synthesis || typeof o.regime_synthesis !== "object") return false;
  if (typeof o.risk_of_ruin !== "string") return false;
  if (!o.positioning_context || typeof o.positioning_context !== "object") return false;
  if (!o.self_check || typeof o.self_check !== "object") return false;
  return true;
}

/** Desk recommendation payload: classic four-topic desk or Conviction memo JSON. */
export type DeskResult = DeskResultClassic | ConvictionDeskResult;

/** Mirrors server push logic for toast copy (trade vs pass on desk / conviction desk). */
export function deskRecommendationHasTrade(result: {
  status?: string;
  deskResult?: DeskResult | null;
}): boolean {
  if (result.status !== "desk_recommendation" || !result.deskResult) return false;
  const dr = result.deskResult;
  if (dr.mode === "conviction_desk") {
    return (
      isConvictionDeskOutputComplete(dr.conviction) &&
      dr.conviction.pm.decision === "trade" &&
      dr.conviction.pm.structure != null
    );
  }
  return dr.pm.decision === "trade";
}

/** Human-readable structure label when `deskRecommendationHasTrade` is true (e.g. "bull call spread"). */
export function deskTradeStructureSentenceCase(result: {
  status?: string;
  deskResult?: DeskResult | null;
}): string | null {
  if (!deskRecommendationHasTrade(result) || !result.deskResult) return null;
  const dr = result.deskResult;
  const structure =
    dr.mode === "conviction_desk" ? dr.conviction?.pm.structure ?? null : dr.pm.structure;
  const raw = structure?.type;
  if (!raw || typeof raw !== "string") return null;
  const words = raw.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
