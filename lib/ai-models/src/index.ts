/**
 * Canonical LLM catalog for Alpha Terminal selectors (AI Parameters, chat, strategist).
 * API model ids must match provider documentation; labels are UI-facing.
 */

export type AiModelProvider = "anthropic" | "google" | "openai";

/** Strategist routing may still accept legacy xAI ids via `provider:model` overrides. */
export type StrategistModelProvider = AiModelProvider | "xai";

export type AiModelId =
  | "gemini-3.5-flash"
  | "gemini-3.1-pro-preview"
  | "claude-opus-4-8"
  | "claude-sonnet-4-6"
  | "gpt-5.5"
  | "gpt-5.4-mini";

export interface AiModelCatalogEntry {
  id: AiModelId;
  provider: AiModelProvider;
  /** Human-readable label for dropdowns and strategist catalog. */
  label: string;
}

/**
 * Production model set (order = strategist catalog indices 0–5).
 * - `gemini-3.5-flash` is Google's API id for Gemini 3.5 Flash; thinking is enabled via thinkingConfig (not a separate model name).
 * - `gpt-5.4-mini` uses OpenAI reasoning_effort medium (5.5 uses high).
 */
export const AI_MODEL_CATALOG: readonly AiModelCatalogEntry[] = [
  { id: "gemini-3.5-flash", provider: "google", label: "Gemini 3.5 Flash + thinking" },
  { id: "gemini-3.1-pro-preview", provider: "google", label: "Gemini 3.1 Pro + thinking" },
  { id: "claude-opus-4-8", provider: "anthropic", label: "Claude Opus 4.8 + adaptive thinking" },
  { id: "claude-sonnet-4-6", provider: "anthropic", label: "Claude Sonnet 4.6 + thinking" },
  { id: "gpt-5.5", provider: "openai", label: "GPT-5.5 + thinking (high)" },
  { id: "gpt-5.4-mini", provider: "openai", label: "GPT-5.4 Mini + thinking (medium)" },
] as const;

export const AI_MODEL_IDS: readonly AiModelId[] = AI_MODEL_CATALOG.map((e) => e.id);

export const DEFAULT_AI_MODEL_ID: AiModelId = "claude-opus-4-8";

const AI_MODEL_ID_SET = new Set<string>(AI_MODEL_IDS);

export function isAiModelId(value: string): value is AiModelId {
  return AI_MODEL_ID_SET.has(value);
}

/** Coerce persisted or API model strings onto the catalog (unknown → default). */
export function normalizeAiModelId(value: string | undefined | null): AiModelId {
  if (value && isAiModelId(value)) return value;
  return DEFAULT_AI_MODEL_ID;
}

export const AI_MODEL_LABEL_BY_ID: Record<AiModelId, string> = Object.fromEntries(
  AI_MODEL_CATALOG.map((e) => [e.id, e.label]),
) as Record<AiModelId, string>;

export function aiModelSelectLabel(id: string): string {
  if (isAiModelId(id)) return AI_MODEL_LABEL_BY_ID[id];
  return id;
}

export const MODELS_BY_PROVIDER: Record<AiModelProvider, readonly AiModelId[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6"],
  google: ["gemini-3.5-flash", "gemini-3.1-pro-preview"],
  openai: ["gpt-5.5", "gpt-5.4-mini"],
};

export function modelsForProvider(provider: string): readonly AiModelId[] {
  if (provider === "anthropic" || provider === "google" || provider === "openai") {
    return MODELS_BY_PROVIDER[provider];
  }
  return AI_MODEL_IDS;
}

/** Strategist settings store integer indices into this catalog. */
export interface StrategistModelOption {
  provider: StrategistModelProvider;
  model: string;
  label: string;
}

export const STRATEGIST_MODEL_OPTIONS: readonly StrategistModelOption[] = AI_MODEL_CATALOG.map((e) => ({
  provider: e.provider,
  model: e.id,
  label: e.label,
}));

export const STRATEGIST_MODEL_CATALOG_VERSION = 6;

/** Remap v5 strategist catalog indices (8 models) → v6 (6 models). */
export const STRATEGIST_CATALOG_V5_TO_V6_INDEX: readonly number[] = [
  2, // 0 opus 4.8 → 2
  4, // 1 gpt-5.5 → 4
  5, // 2 gpt-5.4-mini → 5
  1, // 3 gemini 3.1 pro → 1
  0, // 4 gemini 3 flash → 0 (3.5 + thinking)
  2, // 5 grok → 2 (opus)
  3, // 6 sonnet 4.6 → 3
  3, // 7 haiku → 3 (sonnet)
];

export function remapStrategistCatalogIndexV5ToV6(idx: number): number {
  if (!Number.isFinite(idx) || idx < 0) return 0;
  const i = Math.floor(idx);
  if (i < STRATEGIST_CATALOG_V5_TO_V6_INDEX.length) {
    return STRATEGIST_CATALOG_V5_TO_V6_INDEX[i]!;
  }
  return 0;
}

/** Legacy persisted model ids → catalog id (AI Parameters / chat). */
const LEGACY_MODEL_TO_CATALOG: Record<string, AiModelId> = {
  "claude-opus-4-7": "claude-opus-4-8",
  "claude-opus-4-6": "claude-opus-4-8",
  "claude-opus-4-20250514": "claude-opus-4-8",
  "claude-haiku-4-5": "claude-sonnet-4-6",
  "gemini-3-flash-preview": "gemini-3.5-flash",
  "gemini-2.5-pro": "gemini-3.5-flash",
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.0-flash": "gemini-3.1-pro-preview",
  "gpt-5.4": "gpt-5.5",
  "gpt-5.2": "gpt-5.5",
  "gpt-5": "gpt-5.5",
  "gpt-5-mini": "gpt-5.4-mini",
  "grok-4-1-fast-reasoning": "claude-opus-4-8",
  "grok-4": "claude-opus-4-8",
  "grok-3": "claude-opus-4-8",
};

export function migrateLegacyModelIdToCatalog(value: string | undefined | null): AiModelId {
  if (!value) return DEFAULT_AI_MODEL_ID;
  if (isAiModelId(value)) return value;
  return LEGACY_MODEL_TO_CATALOG[value] ?? DEFAULT_AI_MODEL_ID;
}

/** Anthropic Messages API `output_config.effort` for Claude Opus 4.7+ (4.8 recommended). */
export const ANTHROPIC_OPUS_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type AnthropicOpusEffort = (typeof ANTHROPIC_OPUS_EFFORT_LEVELS)[number];

export const DEFAULT_ANTHROPIC_OPUS_EFFORT: AnthropicOpusEffort = "high";

const ANTHROPIC_OPUS_EFFORT_SET = new Set<string>(ANTHROPIC_OPUS_EFFORT_LEVELS);

/** UI labels (API value `xhigh` shown as Extra per Claude product copy). */
export const ANTHROPIC_OPUS_EFFORT_LABELS: Record<AnthropicOpusEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra (xhigh)",
  max: "Max",
};

/** True when the model resolves to catalog Opus 4.7+ (effort + fast mode supported). */
export function isAnthropicOpusEffortModel(model: string): boolean {
  if (!model?.trim()) return false;
  const trimmed = model.trim();
  if (migrateLegacyModelIdToCatalog(trimmed) === "claude-opus-4-8") return true;
  return /^claude-opus-4-([7-9]|\d{2,})(?:[-._]|$)/.test(trimmed);
}

export function normalizeAnthropicOpusEffort(value: unknown): AnthropicOpusEffort {
  if (typeof value === "string" && ANTHROPIC_OPUS_EFFORT_SET.has(value)) {
    return value as AnthropicOpusEffort;
  }
  return DEFAULT_ANTHROPIC_OPUS_EFFORT;
}

export function anthropicOpusEffortFromStrategistIdx(idx: number): AnthropicOpusEffort {
  if (!Number.isFinite(idx) || idx < 0) return DEFAULT_ANTHROPIC_OPUS_EFFORT;
  const i = Math.floor(idx);
  return ANTHROPIC_OPUS_EFFORT_LEVELS[i] ?? DEFAULT_ANTHROPIC_OPUS_EFFORT;
}

/** Parse optional `anthropic_opus_effort` from API / chat POST bodies. */
export function parseAnthropicOpusEffortBody(raw: unknown): AnthropicOpusEffort | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "string") return normalizeAnthropicOpusEffort(raw);
  return undefined;
}

/** Anthropic Messages API `speed` for Claude Opus 4.6+ (fast ≈ 2.5× output tok/s, premium pricing). */
export const ANTHROPIC_OPUS_SPEED_LEVELS = ["standard", "fast"] as const;

export type AnthropicOpusSpeed = (typeof ANTHROPIC_OPUS_SPEED_LEVELS)[number];

export const DEFAULT_ANTHROPIC_OPUS_SPEED: AnthropicOpusSpeed = "standard";

const ANTHROPIC_OPUS_SPEED_SET = new Set<string>(ANTHROPIC_OPUS_SPEED_LEVELS);

export const ANTHROPIC_OPUS_SPEED_LABELS: Record<AnthropicOpusSpeed, string> = {
  standard: "Standard",
  fast: "Fast (2.5× output speed)",
};

export function normalizeAnthropicOpusSpeed(value: unknown): AnthropicOpusSpeed {
  if (typeof value === "string" && ANTHROPIC_OPUS_SPEED_SET.has(value)) {
    return value as AnthropicOpusSpeed;
  }
  return DEFAULT_ANTHROPIC_OPUS_SPEED;
}

export function anthropicOpusSpeedFromStrategistIdx(idx: number): AnthropicOpusSpeed {
  return Math.floor(idx) === 1 ? "fast" : "standard";
}

export function parseAnthropicOpusSpeedBody(raw: unknown): AnthropicOpusSpeed | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "string") return normalizeAnthropicOpusSpeed(raw);
  return undefined;
}

/** Per-request Opus tuning passed from UI / strategist settings. */
export type AnthropicOpusCallOptions = {
  effort?: AnthropicOpusEffort | null;
  speed?: AnthropicOpusSpeed | null;
};

export function parseAnthropicOpusCallOptionsBody(body: {
  anthropic_opus_effort?: unknown;
  anthropic_opus_speed?: unknown;
}): AnthropicOpusCallOptions {
  return {
    effort: parseAnthropicOpusEffortBody(body.anthropic_opus_effort),
    speed: parseAnthropicOpusSpeedBody(body.anthropic_opus_speed),
  };
}

/** Combine persisted UI fields for API / SDK calls. */
export function anthropicOpusCallOptionsFromSettings(
  effort?: AnthropicOpusEffort | null,
  speed?: AnthropicOpusSpeed | null,
): AnthropicOpusCallOptions {
  return {
    ...(effort != null ? { effort } : {}),
    ...(speed != null && speed !== DEFAULT_ANTHROPIC_OPUS_SPEED ? { speed } : {}),
  };
}
