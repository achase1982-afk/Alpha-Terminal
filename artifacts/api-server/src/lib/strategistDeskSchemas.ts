import { z } from "zod";

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

export const PmOutputSchema = z.object({
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
});

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
  models: {
    vol: string;
    flow: string;
    catalyst: string;
    pm: string;
  };
  errors?: string[];
}
