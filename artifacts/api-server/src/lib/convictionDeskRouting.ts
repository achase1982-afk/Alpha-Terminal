import type { StrategistConfig } from "./strategistSettings.js";
import { getStrategistModel, type StrategistModelOption } from "./strategistSettings.js";

/** Request-body override for which LLM runs Conviction Desk (per-run A/B). */
export const CONVICTION_DESK_ROUTING_KEYS = [
  "anthropic-opus-4-7",
  "anthropic-haiku-4-5",
  "openai-gpt-5-5-thinking",
  "gemini-2-5-pro",
] as const;

export type ConvictionDeskRoutingKey = (typeof CONVICTION_DESK_ROUTING_KEYS)[number];

export function isConvictionDeskRoutingKey(v: unknown): v is ConvictionDeskRoutingKey {
  return typeof v === "string" && (CONVICTION_DESK_ROUTING_KEYS as readonly string[]).includes(v);
}

/** Telemetry `strategist_telemetry.provider` uses "gemini" (not "google"). */
export type ConvictionDeskTelemetryProvider = "anthropic" | "openai" | "gemini";

export function strategistProviderToTelemetryProvider(
  p: StrategistModelOption["provider"],
): ConvictionDeskTelemetryProvider | null {
  if (p === "google") return "gemini";
  if (p === "anthropic") return "anthropic";
  if (p === "openai") return "openai";
  return null;
}

export type ResolvedConvictionDeskRouting = {
  model: StrategistModelOption;
  routingKey: ConvictionDeskRoutingKey | null;
  /** Anthropic `thinking.budget_tokens` when model uses non-adaptive extended thinking. */
  anthropicThinkingBudgetOverride?: number;
};

const ROUTING_TABLE: Record<
  ConvictionDeskRoutingKey,
  { model: StrategistModelOption; anthropicThinkingBudgetOverride?: number }
> = {
  "anthropic-opus-4-7": {
    model: { provider: "anthropic", model: "claude-opus-4-7", label: "Claude Opus 4.7 (Anthropic)" },
  },
  "anthropic-haiku-4-5": {
    model: { provider: "anthropic", model: "claude-haiku-4-5", label: "Claude Haiku 4.5 + thinking (Anthropic)" },
    anthropicThinkingBudgetOverride: 10_000,
  },
  "openai-gpt-5-5-thinking": {
    model: { provider: "openai", model: "gpt-5.5", label: "GPT-5.5 + Thinking (OpenAI)" },
  },
  "gemini-2-5-pro": {
    model: { provider: "google", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Google)" },
  },
};

/**
 * Resolves the Conviction Desk model: explicit `convictionDeskProvider` body wins;
 * otherwise `strategistConvictionModelIdx` (existing production behavior).
 */
export function resolveConvictionDeskRouting(
  settings: StrategistConfig,
  convictionDeskProvider?: ConvictionDeskRoutingKey | null,
): ResolvedConvictionDeskRouting {
  if (convictionDeskProvider && isConvictionDeskRoutingKey(convictionDeskProvider)) {
    const row = ROUTING_TABLE[convictionDeskProvider];
    return {
      model: row.model,
      routingKey: convictionDeskProvider,
      ...(row.anthropicThinkingBudgetOverride != null
        ? { anthropicThinkingBudgetOverride: row.anthropicThinkingBudgetOverride }
        : {}),
    };
  }
  const model = getStrategistModel(settings.strategistConvictionModelIdx);
  return { model, routingKey: null };
}
