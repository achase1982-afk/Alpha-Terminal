import type { StrategistConfig } from "./strategistSettings.js";
import {
  getStrategistModel,
  STRATEGIST_MODEL_OPTIONS,
  type StrategistModelOption,
} from "./strategistSettings.js";

/** Short-cut tokens for common Conviction Desk A/B configs (POST /analyze body). */
export const CONVICTION_DESK_ROUTING_KEYS = [
  "anthropic-opus-4-8",
  /** @deprecated use anthropic-opus-4-8 */
  "anthropic-opus-4-7",
  "anthropic-sonnet-4-6",
  "openai-gpt-5-5-thinking",
  "openai-gpt-5-4-mini",
  "gemini-3-5-flash",
  "gemini-3-1-pro",
  /** @deprecated */
  "anthropic-haiku-4-5",
  /** @deprecated */
  "gemini-2-5-pro",
] as const;

export type ConvictionDeskRoutingKey = (typeof CONVICTION_DESK_ROUTING_KEYS)[number];

export function isConvictionDeskRoutingKey(v: unknown): v is ConvictionDeskRoutingKey {
  return typeof v === "string" && (CONVICTION_DESK_ROUTING_KEYS as readonly string[]).includes(v);
}

/**
 * Normalizes POST /analyze `convictionDeskProvider` for Conviction Desk (mode 5).
 * Accepts legacy short-cut strings, or `provider:model` for any catalog / API model id, e.g.:
 * `openai:gpt-5.4-mini`, `openai:gpt-5.1`, `google:gemini-3-flash-preview`, `gemini:gemini-3.1-pro-preview`,
 * `anthropic:claude-sonnet-4-6`. Alias `gemini:` → Google provider.
 * Invalid or empty values return undefined (falls back to strategist conviction model index).
 */
export function normalizeConvictionDeskProviderBody(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (isConvictionDeskRoutingKey(s)) return s;
  if (FLEX_PROVIDER_MODEL.test(s)) return s;
  return undefined;
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
  /** Set when a legacy short-cut key was used; null for settings default or `provider:model` overrides. */
  routingKey: ConvictionDeskRoutingKey | null;
  /** Anthropic `thinking.budget_tokens` when model uses non-adaptive extended thinking. */
  anthropicThinkingBudgetOverride?: number;
};

const ROUTING_TABLE: Record<
  ConvictionDeskRoutingKey,
  { model: StrategistModelOption; anthropicThinkingBudgetOverride?: number }
> = {
  "anthropic-opus-4-8": {
    model: { provider: "anthropic", model: "claude-opus-4-8", label: "Claude Opus 4.8 + adaptive thinking" },
  },
  /** @deprecated legacy routing key — maps to Opus 4.8 */
  "anthropic-opus-4-7": {
    model: { provider: "anthropic", model: "claude-opus-4-8", label: "Claude Opus 4.8 + adaptive thinking" },
  },
  "anthropic-sonnet-4-6": {
    model: { provider: "anthropic", model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 + thinking" },
  },
  "openai-gpt-5-5-thinking": {
    model: { provider: "openai", model: "gpt-5.5", label: "GPT-5.5 + thinking" },
  },
  "openai-gpt-5-4-mini": {
    model: { provider: "openai", model: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  },
  "gemini-3-5-flash": {
    model: { provider: "google", model: "gemini-3.5-flash", label: "Gemini 3.5 + thinking" },
  },
  "gemini-3-1-pro": {
    model: { provider: "google", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  },
  /** @deprecated legacy routing key — maps to Gemini 3.5 + thinking */
  "anthropic-haiku-4-5": {
    model: { provider: "anthropic", model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 + thinking" },
  },
  /** @deprecated legacy routing key — maps to Gemini 3.5 + thinking */
  "gemini-2-5-pro": {
    model: { provider: "google", model: "gemini-3.5-flash", label: "Gemini 3.5 + thinking" },
  },
};

const FLEX_PROVIDER_MODEL = /^(anthropic|openai|google|gemini)\s*:\s*(.+)$/i;

function labelForProviderModel(provider: StrategistModelOption["provider"], model: string): string {
  const hit = STRATEGIST_MODEL_OPTIONS.find((o) => o.provider === provider && o.model === model);
  return hit?.label ?? `${model} (${provider})`;
}

function parseFlexibleProviderModel(s: string): ResolvedConvictionDeskRouting | null {
  const m = s.trim().match(FLEX_PROVIDER_MODEL);
  if (!m) return null;
  const head = m[1].toLowerCase();
  const model = m[2].trim();
  if (!model || model.length > 160) return null;
  const provider = (head === "gemini" ? "google" : head) as StrategistModelOption["provider"];
  if (provider !== "anthropic" && provider !== "openai" && provider !== "google") return null;
  const option: StrategistModelOption = {
    provider,
    model,
    label: labelForProviderModel(provider, model),
  };
  const anthropicThinkingBudgetOverride =
    provider === "anthropic" && model === "claude-haiku-4-5" ? 10_000 : undefined;
  return {
    model: option,
    routingKey: null,
    ...(anthropicThinkingBudgetOverride != null ? { anthropicThinkingBudgetOverride } : {}),
  };
}

/**
 * Resolves the Conviction Desk model: explicit `convictionDeskProvider` body wins
 * (legacy short-cut or `provider:model`); otherwise `strategistConvictionModelIdx`.
 */
export function resolveConvictionDeskRouting(
  settings: StrategistConfig,
  convictionDeskProvider?: string | null,
): ResolvedConvictionDeskRouting {
  const raw = convictionDeskProvider?.trim() ?? "";
  if (raw) {
    if (isConvictionDeskRoutingKey(raw)) {
      const row = ROUTING_TABLE[raw];
      return {
        model: row.model,
        routingKey: raw,
        ...(row.anthropicThinkingBudgetOverride != null
          ? { anthropicThinkingBudgetOverride: row.anthropicThinkingBudgetOverride }
          : {}),
      };
    }
    const flex = parseFlexibleProviderModel(raw);
    if (flex) return flex;
  }
  const model = getStrategistModel(settings.strategistConvictionModelIdx);
  return { model, routingKey: null };
}
