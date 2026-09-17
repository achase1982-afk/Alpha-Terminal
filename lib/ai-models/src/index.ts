/**
 * Canonical LLM catalog for Alpha Terminal selectors (AI Parameters, chat, strategist).
 * API model ids must match provider documentation; labels are UI-facing.
 */

export type AiModelProvider = "anthropic" | "google" | "openai";

/** Strategist routing may still accept legacy xAI ids via `provider:model` overrides. */
export type StrategistModelProvider = AiModelProvider | "xai";

export type AiModelId =
  | "gemini-3.8-flash"
  | "gemini-3.1-pro-preview"
  | "claude-fable-5-1"
  | "claude-opus-5"
  | "claude-sonnet-5"
  | "gpt-6-astra"
  | "gpt-5.6-terra";

export interface AiModelCatalogEntry {
  id: AiModelId;
  provider: AiModelProvider;
  /** Human-readable label for dropdowns and strategist catalog. */
  label: string;
}

/**
 * Production model set. Array order = strategist catalog indices (v7):
 * 0 Gemini Flash, 1 Gemini Pro, 2 Fable, 3 Opus, 4 Sonnet, 5 GPT flagship, 6 GPT mini-tier.
 * Never reorder: strategist settings persist integer indices into this array.
 * - `gemini-3.8-flash` is Google's API id for Gemini 3.8 Flash; thinking is enabled via thinkingConfig (not a separate model name).
 * - `gemini-3.1-pro-preview` remains Google's newest Pro-tier model.
 * - `claude-opus-5` / `claude-sonnet-5` / `claude-fable-5-1` are fixed ids (no date suffix); all use adaptive thinking.
 * - `gpt-6-astra` uses OpenAI reasoning effort high; `gpt-5.6-terra` (mini-tier successor) uses medium.
 */
export const AI_MODEL_CATALOG: readonly AiModelCatalogEntry[] = [
  { id: "gemini-3.8-flash", provider: "google", label: "Gemini 3.8 Flash + thinking" },
  { id: "gemini-3.1-pro-preview", provider: "google", label: "Gemini 3.1 Pro + thinking" },
  { id: "claude-fable-5-1", provider: "anthropic", label: "Claude Fable 5.1 + adaptive thinking" },
  { id: "claude-opus-5", provider: "anthropic", label: "Claude Opus 5 + adaptive thinking" },
  { id: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5 + adaptive thinking" },
  { id: "gpt-6-astra", provider: "openai", label: "GPT-6 Astra + thinking (high)" },
  { id: "gpt-5.6-terra", provider: "openai", label: "GPT-5.6 Terra + thinking (medium)" },
] as const;

export const AI_MODEL_IDS: readonly AiModelId[] = AI_MODEL_CATALOG.map((e) => e.id);

export const DEFAULT_AI_MODEL_ID: AiModelId = "claude-opus-5";

const AI_MODEL_ID_SET = new Set<string>(AI_MODEL_IDS);

export function isAiModelId(value: string): value is AiModelId {
  return AI_MODEL_ID_SET.has(value);
}

/** Coerce persisted or API model strings onto the catalog (legacy ids remap; unknown → default). */
export function normalizeAiModelId(value: string | undefined | null): AiModelId {
  return migrateLegacyModelIdToCatalog(value);
}

export const AI_MODEL_LABEL_BY_ID: Record<AiModelId, string> = Object.fromEntries(
  AI_MODEL_CATALOG.map((e) => [e.id, e.label]),
) as Record<AiModelId, string>;

export function aiModelSelectLabel(id: string): string {
  if (isAiModelId(id)) return AI_MODEL_LABEL_BY_ID[id];
  return id;
}

export const MODELS_BY_PROVIDER: Record<AiModelProvider, readonly AiModelId[]> = {
  anthropic: ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"],
  google: ["gemini-3.8-flash", "gemini-3.1-pro-preview"],
  openai: ["gpt-6-astra", "gpt-5.6-terra"],
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

/**
 * v7 catalog shape (seven slots). The 2026-09 model refresh (Gemini 3.8 Flash, Opus 5,
 * Sonnet 5, GPT-6 Astra, GPT-5.6 Terra, Fable 5.1) swapped ids in place, so persisted
 * indices stay valid and no version bump was needed.
 */
export const STRATEGIST_MODEL_CATALOG_VERSION = 7;

/** Remap v5 strategist catalog indices (8 models) → v6 (6 models). */
export const STRATEGIST_CATALOG_V5_TO_V6_INDEX: readonly number[] = [
  2, // 0 opus → 2 (Opus slot)
  4, // 1 gpt flagship → 4
  5, // 2 gpt mini → 5
  1, // 3 gemini pro → 1
  0, // 4 gemini flash → 0 (Flash + thinking)
  2, // 5 grok → 2 (Opus slot)
  3, // 6 sonnet → 3
  3, // 7 haiku → 3 (Sonnet slot)
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
  // Anthropic
  "claude-fable-5": "claude-fable-5-1",
  "claude-opus-4-8": "claude-opus-5",
  "claude-opus-4-7": "claude-opus-5",
  "claude-opus-4-6": "claude-opus-5",
  "claude-opus-4-20250514": "claude-opus-5",
  "claude-sonnet-4-7": "claude-sonnet-5",
  "claude-sonnet-4-6": "claude-sonnet-5",
  "claude-sonnet-4-20250514": "claude-sonnet-5",
  "claude-haiku-4-5": "claude-sonnet-5",
  // Google
  "gemini-3.7-flash": "gemini-3.8-flash",
  "gemini-3.6-flash": "gemini-3.8-flash",
  "gemini-3.5-flash": "gemini-3.8-flash",
  "gemini-3-flash-preview": "gemini-3.8-flash",
  "gemini-2.5-pro": "gemini-3.8-flash",
  "gemini-2.5-flash": "gemini-3.8-flash",
  "gemini-2.0-flash": "gemini-3.1-pro-preview",
  // OpenAI
  "gpt-5.6-sol": "gpt-6-astra",
  "gpt-5.6": "gpt-6-astra",
  "gpt-5.5": "gpt-6-astra",
  "gpt-5.4": "gpt-6-astra",
  "gpt-5.2": "gpt-6-astra",
  "gpt-5": "gpt-6-astra",
  "gpt-5.6-luna": "gpt-5.6-terra",
  "gpt-5.4-mini": "gpt-5.6-terra",
  "gpt-5-mini": "gpt-5.6-terra",
  // xAI (no longer in the catalog)
  "grok-4-1-fast-reasoning": "claude-opus-5",
  "grok-4": "claude-opus-5",
  "grok-3": "claude-opus-5",
};

export function migrateLegacyModelIdToCatalog(value: string | undefined | null): AiModelId {
  if (!value) return DEFAULT_AI_MODEL_ID;
  if (isAiModelId(value)) return value;
  return LEGACY_MODEL_TO_CATALOG[value] ?? DEFAULT_AI_MODEL_ID;
}

/** v7 added the Fable slot; shipped as an identity remap for indices 0–5. */
export const STRATEGIST_CATALOG_V6_TO_V7_INDEX: readonly number[] = [0, 1, 2, 3, 4, 5];

export function remapStrategistCatalogIndexV6ToV7(idx: number): number {
  if (!Number.isFinite(idx) || idx < 0) return 0;
  const i = Math.floor(idx);
  if (i < STRATEGIST_CATALOG_V6_TO_V7_INDEX.length) {
    return STRATEGIST_CATALOG_V6_TO_V7_INDEX[i]!;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Anthropic model-family helpers
// ---------------------------------------------------------------------------

export type ClaudeModelFamily = "opus" | "sonnet" | "haiku" | "fable";

export interface ClaudeModelVersion {
  family: ClaudeModelFamily;
  major: number;
  /** 0 when the id has no minor component (e.g. `claude-opus-5`, or a date-stamped 4.0 snapshot). */
  minor: number;
}

/**
 * Parse `claude-<family>-<major>[-<minor>]` ids such as `claude-opus-5`,
 * `claude-fable-5-1`, `claude-opus-4-8`, `claude-sonnet-4-7-20250514`.
 * Date-stamped snapshots (`claude-opus-4-20250514`) parse as minor 0.
 * Returns null for non-Claude or pre-4.x ids (`claude-3-5-sonnet-…`).
 */
export function parseClaudeModelVersion(model: string): ClaudeModelVersion | null {
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,3}))?(?:[-._]|$)/i.exec(model?.trim() ?? "");
  if (!m) return null;
  return {
    family: m[1]!.toLowerCase() as ClaudeModelFamily,
    major: Number(m[2]),
    minor: m[3] != null ? Number(m[3]) : 0,
  };
}

/** Opus/Sonnet 4.7+ and every 5.x model share the adaptive-thinking / effort request surface. */
function isClaude47OrNewerVersion(v: ClaudeModelVersion): boolean {
  if (v.major >= 5) return true;
  return v.major === 4 && v.minor >= 7;
}

/** Anthropic Messages API `output_config.effort` for Claude Opus 4.7+, Opus 5, Fable 5.x, etc. */
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

export function isAnthropicFableModel(model: string): boolean {
  if (!model?.trim()) return false;
  const trimmed = model.trim();
  if (migrateLegacyModelIdToCatalog(trimmed) === "claude-fable-5-1") return true;
  return parseClaudeModelVersion(trimmed)?.family === "fable";
}

/**
 * True when the model uses adaptive thinking (`thinking: { type: "adaptive" }`) and rejects
 * `budget_tokens`: Fable 5.x, Opus 5, Sonnet 5, Opus/Sonnet 4.7+.
 */
export function isAnthropicAdaptiveThinkingModel(model: string): boolean {
  if (!model?.trim()) return false;
  if (isAnthropicFableModel(model)) return true;
  const v = parseClaudeModelVersion(model);
  if (!v || (v.family !== "opus" && v.family !== "sonnet")) return false;
  return isClaude47OrNewerVersion(v);
}

/**
 * True when the model supports API `output_config.effort`: Opus 4.7+, Opus 5, Sonnet 5, Fable 5.x.
 * (Name kept for existing call sites; the effort selector is the replacement for the temperature
 * slider on every adaptive-thinking model, not just Opus.)
 */
export function isAnthropicOpusEffortModel(model: string): boolean {
  if (!model?.trim()) return false;
  const trimmed = model.trim();
  if (isAnthropicFableModel(trimmed)) return true;
  // Legacy Opus ids (4.6, date-stamped 4.0, retired xAI slots) remap to Opus 5 and keep effort.
  // Sonnet is version-gated only: Haiku 4.5 / Sonnet 4.6 also remap to Sonnet 5 but reject effort.
  if (migrateLegacyModelIdToCatalog(trimmed) === "claude-opus-5") return true;
  const v = parseClaudeModelVersion(trimmed);
  if (!v) return false;
  if (v.family === "opus") return isClaude47OrNewerVersion(v);
  if (v.family === "sonnet") return v.major >= 5;
  return false;
}

/** Opus-only fast mode (`speed: "fast"`; Opus 5 / Opus 4.8). Sonnet and Fable do not support fast mode. */
export function isAnthropicOpusSpeedModel(model: string): boolean {
  if (!isAnthropicOpusEffortModel(model) || isAnthropicFableModel(model)) return false;
  const trimmed = model.trim();
  if (migrateLegacyModelIdToCatalog(trimmed) === "claude-opus-5") return true;
  return parseClaudeModelVersion(trimmed)?.family === "opus";
}

/** Custom temperature/top_p/top_k are rejected on adaptive-thinking Anthropic models (Opus/Sonnet 4.7+, 5.x, Fable); effort replaces it. */
export function isAnthropicTemperatureConfigurable(model: string): boolean {
  if (!/^claude-/i.test(model?.trim() ?? "")) return true;
  if (isAnthropicOpusEffortModel(model)) return false;
  if (/^claude-3-/i.test(model)) return true;
  if (/haiku/i.test(model)) return true;
  return !isAnthropicAdaptiveThinkingModel(model);
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

/** Anthropic Messages API `speed` for Claude Opus 5 / Opus 4.8 (fast ≈ 2.5× output tok/s, premium pricing). */
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

// ---------------------------------------------------------------------------
// OpenAI model-family helpers
// ---------------------------------------------------------------------------

/**
 * GPT-5.x / GPT-6.x and o-series models are reasoning models: they take `reasoning.effort`
 * (Responses) / `reasoning_effort` (Chat Completions), require `max_completion_tokens`,
 * and reject custom `temperature` / `top_p`.
 */
export function isOpenAiReasoningModel(model: string): boolean {
  const m = model?.trim() ?? "";
  if (!m) return false;
  if (/^gpt-5-chat/.test(m)) return false;
  return /^gpt-(?:[5-9]|\d{2,})/.test(m) || /^o\d/.test(m);
}

export type OpenAiReasoningEffort = "low" | "medium" | "high";

/** Flagship OpenAI reasoning models (GPT-6.x, GPT-5.5, GPT-5.6 Sol) run at `high`; the rest at `medium`. */
export function openAiReasoningEffortForModel(model: string): OpenAiReasoningEffort {
  const m = model?.trim() ?? "";
  if (/^gpt-(?:[6-9]|\d{2,})/.test(m)) return "high";
  if (/^gpt-5\.5/.test(m)) return "high";
  if (/^gpt-5\.6(?:-sol)?(?:-\d|$)/.test(m)) return "high";
  return "medium";
}
