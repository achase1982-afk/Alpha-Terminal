import { z } from "zod";
import type { ConvictionDeskRunDiagnostic } from "./convictionDeskRunDiagnostic.js";

/** Strategist options-chain skew snapshot (summarizeOptionsChain / ChainSummary subset). */
export const StrategistSkew25DeltaSchema = z.object({
  putIV: z.number(),
  callIV: z.number(),
  skewPoints: z.number(),
  asOfExpiry: z.string(),
});

/**
 * Payload slice for 25Δ skew: numeric skew object (nullable) plus machine-readable reason (always set).
 * Reason includes `clean_25d_first_expiry`, `skew_fallback_*`, `no_expirations`, `no_valid_expiry`, `skew_indeterminate_*`, etc.
 */
export const StrategistChainSkewPayloadSchema = z.object({
  skew25Delta: StrategistSkew25DeltaSchema.nullable(),
  skew25DeltaReason: z.string(),
});

export type StrategistChainSkewPayload = z.infer<typeof StrategistChainSkewPayloadSchema>;

export const DeskKeyStrikeSchema = z.object({
  strike: z.number(),
  expiry: z.string(),
  type: z.string(),
  observation: z.string(),
});

export const VolAnalystOutputSchema = z.object({
  iv_state: z.string(),
  term_structure: z.string(),
  skew: z.string(),
  implied_vs_realized: z.string(),
  read: z.string(),
});

export const FlowAnalystOutputSchema = z.object({
  dominant_flow: z.string(),
  institutional_signal: z.string(),
  retail_signal: z.string(),
  key_strikes: z.array(DeskKeyStrikeSchema),
  read: z.string(),
});

export const CatalystAnalystOutputSchema = z.object({
  primary_catalyst: z.string(),
  bar_to_clear: z.string(),
  asymmetry: z.string(),
  historical_pattern: z.string(),
  read: z.string(),
});

export const DeskLegSchema = z.object({
  type: z.string(),
  strike: z.number(),
  action: z.string(),
  expiration: z.string(),
  quantity: z.number().optional(),
});

export type DeskLeg = z.infer<typeof DeskLegSchema>;

export const DeskStructureSchema = z.object({
  type: z.string(),
  legs: z.array(DeskLegSchema),
  expiry: z.string(),
  credit_or_debit: z.number(),
});

export const DeskExitPlanSchema = z.object({
  profit_target: z.number(),
  stop_loss: z.number(),
  time_stop: z.string(),
});

export const PayoffScenarioSchema = z.object({
  underlyingPrice: z.number(),
  spreadValue: z.number(),
  pnl: z.number(),
  pnlColor: z.enum(["green", "red", "neutral"]),
});

export const PayoffScenariosSummarySchema = z.object({
  peakPnl: z.number(),
  peakPnlPrice: z.number(),
  /** Lowest grid price with positive P/L (profit zone lower bound). */
  profitZoneLow: z.number().nullable(),
  /** Highest grid price with positive P/L (profit zone upper bound). */
  profitZoneHigh: z.number().nullable(),
  /** First interpolated underlying (above spot) where P/L crosses below -stop loss. */
  upsideBreakdown: z.number().nullable(),
  /** First interpolated underlying (below spot) where P/L crosses below -stop loss. */
  downsideBreakdown: z.number().nullable(),
});

export type PayoffScenario = z.infer<typeof PayoffScenarioSchema>;
export type PayoffScenariosSummary = z.infer<typeof PayoffScenariosSummarySchema>;

/** Remove server-only PM fields before validating LLM JSON (models must not drive payoff math). */
function stripServerOnlyPmFields(input: unknown): unknown {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const o = { ...(input as Record<string, unknown>) };
    delete o.scenarios;
    delete o.scenariosSummary;
    return o;
  }
  return input;
}

export const PmOutputSchema = z.preprocess(
  stripServerOnlyPmFields,
  z.object({
    decision: z.enum(["trade", "pass"]),
    structure: DeskStructureSchema.nullable(),
    thesis: z.string(),
    edge_check: z.string(),
    deviation_from_analysts: z.string(),
    size: z.enum(["small", "medium", "large"]),
    whose_side: z.enum(["institutional_alignment", "retail_fade", "neither"]),
    biggest_risk: z.string(),
    exit_plan: DeskExitPlanSchema,
    watch_for: z.string(),
    /** Server-filled payoff grid at front expiration; omitted when not computed. */
    scenarios: z.array(PayoffScenarioSchema).nullable().optional(),
    scenariosSummary: PayoffScenariosSummarySchema.nullable().optional(),
  }),
);

export type VolAnalystOutput = z.infer<typeof VolAnalystOutputSchema>;
export type FlowAnalystOutput = z.infer<typeof FlowAnalystOutputSchema>;
export type CatalystAnalystOutput = z.infer<typeof CatalystAnalystOutputSchema>;
export type PmOutput = z.infer<typeof PmOutputSchema>;
export type DeskKeyStrike = z.infer<typeof DeskKeyStrikeSchema>;

/** Single-call Desk: one JSON with nested vol / flow / catalyst / pm (same shapes as multi-turn Desk). */
export const SoloDeskFullOutputSchema = z.object({
  vol: VolAnalystOutputSchema,
  flow: FlowAnalystOutputSchema,
  catalyst: CatalystAnalystOutputSchema,
  pm: PmOutputSchema,
});

export type SoloDeskFullOutput = z.infer<typeof SoloDeskFullOutputSchema>;

export interface DeskResult {
  /** `desk` = four LLM turns; `solo_desk` = one consolidated turn, same nested shape for the client. */
  mode: "desk" | "solo_desk";
  ticker: string;
  vol: VolAnalystOutput;
  flow: FlowAnalystOutput;
  catalyst: CatalystAnalystOutput;
  pm: PmOutput;
  /** True when PM JSON failed schema validation after retry. PM fields are a fallback; use strategistOutcome ANALYSIS_INCOMPLETE on the parent result. */
  pmOutputIncomplete?: boolean;
  /**
   * Solo Desk only: set when consolidated JSON failed schema validation after retry.
   * Lets the UI distinguish a stub `pass` from a genuine model pass.
   */
  soloDeskJsonDegraded?: "schema_validation_failed_after_retry";
  models: {
    vol: string;
    flow: string;
    catalyst: string;
    pm: string;
  };
  errors?: string[];
}

const ConvictionFitScoreSchema = z.enum(["high", "medium", "low", "unfit"]);

const ConvictionTradeFamilyHypothesisSchema = z.object({
  family: z.enum(["long_vol", "short_vol", "directional"]),
  candidate_structure: z.string().min(1),
  entry_math: z.string().min(1),
  thesis_this_family_represents: z.string(),
  fit_score: ConvictionFitScoreSchema,
  reason_for_score: z.string(),
  what_would_make_it_unfit: z.string(),
});

const ConvictionPassHypothesisSchema = z.object({
  family: z.literal("pass"),
  candidate_structure: z.null(),
  entry_math: z.null(),
  thesis_this_family_represents: z.string(),
  fit_score: ConvictionFitScoreSchema,
  reason_for_score: z.string(),
  what_would_make_it_unfit: z.string(),
});

/** Exactly four hypotheses: long_vol, short_vol, directional, pass (in that order). */
export const ConvictionFamilyHypothesesSchema = z.tuple([
  ConvictionTradeFamilyHypothesisSchema.extend({ family: z.literal("long_vol") }),
  ConvictionTradeFamilyHypothesisSchema.extend({ family: z.literal("short_vol") }),
  ConvictionTradeFamilyHypothesisSchema.extend({ family: z.literal("directional") }),
  ConvictionPassHypothesisSchema,
]);

const ConvictionSelfCheckSchema = z.object({
  each_family_priced_with_math: z.boolean(),
  each_family_priced_with_math_reason: z.string(),
  decision_consistent_with_strongest_hypothesis: z.boolean(),
  decision_consistent_with_strongest_hypothesis_reason: z.string(),
  call_survives_reverse_family_order: z.boolean(),
  call_survives_reverse_family_order_reason: z.string(),
});

/** Solo Desk JSON shape plus Conviction-only deliberation and synthesis fields (same vol/flow/catalyst/pm schemas). */
export const ConvictionDeskOutputSchema = z.object({
  vol: VolAnalystOutputSchema,
  flow: FlowAnalystOutputSchema,
  catalyst: CatalystAnalystOutputSchema,
  family_hypotheses: ConvictionFamilyHypothesesSchema,
  regime_synthesis: z.object({
    regime_read: z.enum([
      "short_premium_neutral",
      "short_premium_directional",
      "long_premium_neutral",
      "long_premium_directional",
      "pure_directional_long",
      "pure_directional_short",
      "no_edge",
    ]),
    strongest_hypothesis: z.enum(["long_vol", "short_vol", "directional", "pass"]),
    synthesis: z.string(),
  }),
  pm: PmOutputSchema,
  risk_of_ruin: z.string(),
  positioning_context: z.object({
    crowd_state: z.enum(["crowded_long", "crowded_short", "balanced", "unclear"]),
    sell_side_targets_vs_price: z.string(),
    implied_vs_consensus: z.string(),
    upside_fade_risk: z.string(),
    downside_fade_risk: z.string(),
  }),
  self_check: ConvictionSelfCheckSchema,
});

export type ConvictionDeskOutput = z.infer<typeof ConvictionDeskOutputSchema>;

/** Conviction Desk consolidated JSON response (distinct from vol/flow/catalyst/pm desk shape). */
export interface ConvictionDeskResult {
  mode: "conviction_desk";
  ticker: string;
  conviction: ConvictionDeskOutput | null;
  models: DeskResult["models"];
  errors?: string[];
  payoffScenarios?: PayoffScenario[] | null;
  payoffSummary?: PayoffScenariosSummary | null;
  convictionDeskJsonDegraded?: "schema_validation_failed_after_retry" | "stream_error" | "extraction_error";
  /** Persisted on every run for DB-only diagnosis (large; not for logs). */
  convictionDeskRunDiagnostic?: ConvictionDeskRunDiagnostic;
}

export type AnyDeskResult = DeskResult | ConvictionDeskResult;
