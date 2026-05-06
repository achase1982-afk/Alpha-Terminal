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

const ConvictionRegimeVolSchema = z.enum(["chop", "breakout", "squeeze", "panic", "dead"]);
const ConvictionRegimeSectorSchema = z.enum(["leadership", "lagging", "rotation", "neutral", "unavailable"]);
const ConvictionRegimeMacroSchema = z.enum(["risk-on", "risk-off", "event-pending", "mixed"]);
const ConvictionRegimeStockSchema = z.enum([
  "momentum-up",
  "momentum-down",
  "mean-reverting",
  "range-bound",
  "breaking-out",
  "breaking-down",
]);
const ConvictionHoldingWindowSchema = z.enum(["5d", "20d", "50d"]);

const ConvictionRegimeIndicatorsSchema = z.object({
  iv_percentile: z.number().nullable(),
  hv20_percentile: z.number().nullable(),
  pct_from_20dma: z.number().nullable(),
  pct_from_50dma: z.number().nullable(),
  atr14_percentile: z.number().nullable(),
  pct_from_52w_high: z.number().nullable(),
  vix_level: z.number().nullable(),
  days_to_next_macro: z.number().nullable(),
  market_pulse_current: z.number().nullable(),
  market_pulse_20d_avg: z.number().nullable(),
});

const ConvictionOutcomeDistSchema = z.object({
  p5: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p95: z.number(),
});

const ConvictionGreeksEntrySchema = z.object({
  delta: z.number(),
  gamma: z.number(),
  theta: z.number(),
  vega: z.number(),
  front_vega: z.number().optional(),
  back_vega: z.number().optional(),
});

const ConvictionCandidateSchema = z.object({
  structure: z.string(),
  legs: z.array(z.unknown()),
  debit_credit: z.number(),
  greeks_entry: ConvictionGreeksEntrySchema,
  max_profit: z.number(),
  max_loss: z.number(),
  breakevens: z.array(z.number()),
  outcome_distribution: ConvictionOutcomeDistSchema,
  ev_dollars: z.number(),
  regime_fit: z.enum(["fits", "neutral", "fights"]),
  regime_fit_reasoning: z.string(),
});

const ConvictionGreeksEvolutionCellSchema = z.object({
  stock_path: z.enum(["+1σ", "0", "-1σ"]),
  days_held: z.union([z.literal(1), z.literal(3), z.literal("expiry-eve")]),
  greeks: z.object({
    delta: z.number(),
    gamma: z.number(),
    theta: z.number(),
    vega: z.number(),
  }),
});

const ConvictionChosenSchema = z.object({
  structure: z.string(),
  legs: z.array(z.unknown()),
  expiry: z.string(),
  credit_or_debit: z.number(),
  greeks_entry: ConvictionGreeksEntrySchema,
  greeks_evolution: z.array(ConvictionGreeksEvolutionCellSchema).length(9),
  outcome_distribution: ConvictionOutcomeDistSchema,
  ev_dollars: z.number(),
  max_loss: z.number(),
  stop_loss: z.number().optional(),
});

export const ConvictionDeskOutputSchema = z.object({
  regime: z.object({
    vol: ConvictionRegimeVolSchema,
    sector: ConvictionRegimeSectorSchema,
    macro: ConvictionRegimeMacroSchema,
    stock: ConvictionRegimeStockSchema,
    holding_period_window: ConvictionHoldingWindowSchema,
    indicators: ConvictionRegimeIndicatorsSchema,
    summary: z.string(),
  }),
  view: z.object({
    paragraph: z.string(),
    decision_intent: z.enum(["trade", "pass"]),
  }),
  decision: z.object({
    candidates_considered: z.array(ConvictionCandidateSchema).length(3),
    chosen: ConvictionChosenSchema.nullable(),
    rejected_alternatives: z
      .array(
        z.object({
          structure: z.string(),
          reason: z.string(),
        }),
      )
      .length(2),
  }),
  failure_scenario: z.object({
    steelman: z.string(),
    response: z.string(),
    sufficient: z.boolean(),
  }),
  scenarios: z
    .object({
      designed: z.object({
        description: z.string(),
        trade_value_path: z.string(),
        greek_changes: z.string(),
        pnl_per_spread: z.number(),
      }),
      adverse_bounded: z.object({
        description: z.string(),
        trade_value_path: z.string(),
        greek_changes: z.string(),
        pnl_per_spread: z.number(),
        stop_trigger: z.string(),
      }),
      tail: z.object({
        description: z.string(),
        trade_value_path: z.string(),
        pnl_per_spread: z.number(),
      }),
    })
    .nullable(),
  exit_plan: z
    .object({
      profit_take: z.array(
        z.object({
          level: z.string(),
          scale_out_pct: z.number(),
        }),
      ),
      vol_trigger: z.string().nullable(),
      price_trigger: z.string().nullable(),
      time_stop: z.string(),
    })
    .nullable(),
  self_grade: z.object({
    vol: z.enum(["A", "B", "C", "D", "F"]),
    flow: z.enum(["A", "B", "C", "D", "F"]),
    catalyst: z.enum(["A", "B", "C", "D", "F"]),
    regime: z.enum(["A", "B", "C", "D", "F"]),
    structure_fit: z.enum(["A", "B", "C", "D", "F", "N/A"]),
    failure_scenario_strength: z.enum(["A", "B", "C", "D", "F"]),
    conviction: z.enum(["A", "B", "C", "D", "F"]),
    conviction_threshold_met: z.boolean(),
  }),
  size: z.enum(["small", "medium", "large", "no-trade"]),
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
