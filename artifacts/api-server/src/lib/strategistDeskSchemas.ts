import { z } from "zod";

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
