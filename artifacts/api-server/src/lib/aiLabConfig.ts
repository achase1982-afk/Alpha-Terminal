export type AiLabModelProvider = "anthropic" | "google";

export interface AiLabStrategistConfig {
  analystModelProvider: AiLabModelProvider;
  analystModelName: string;
  analystTemperature: number;

  skepticModelProvider: AiLabModelProvider;
  skepticModelName: string;
  skepticTemperature: number;

  enabled: boolean;
  mode: "SHADOW" | "LIVE";
}

const VALID_PROVIDERS = new Set<AiLabModelProvider>(["anthropic", "google"]);
const VALID_MODES = new Set(["SHADOW", "LIVE"]);
const ALLOWED_KEYS = new Set([
  "analystModelProvider", "analystModelName", "analystTemperature",
  "skepticModelProvider", "skepticModelName", "skepticTemperature",
  "enabled", "mode",
]);

const DEFAULT_CONFIG: AiLabStrategistConfig = {
  analystModelProvider: "anthropic",
  analystModelName: "claude-sonnet-4-20250514",
  analystTemperature: 0,

  skepticModelProvider: "google",
  skepticModelName: "gemini-2.5-flash",
  skepticTemperature: 0,

  enabled: false,
  mode: "LIVE",
};

let currentConfig: AiLabStrategistConfig = { ...DEFAULT_CONFIG };

export function getAiLabStrategistConfig(): Readonly<AiLabStrategistConfig> {
  return currentConfig;
}

export function updateAiLabStrategistConfig(
  partial: Partial<AiLabStrategistConfig>,
): AiLabStrategistConfig {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(partial)) {
    if (ALLOWED_KEYS.has(key)) sanitized[key] = value;
  }

  if (sanitized.analystModelProvider !== undefined && !VALID_PROVIDERS.has(sanitized.analystModelProvider as AiLabModelProvider)) {
    throw new Error(`Invalid analystModelProvider: ${sanitized.analystModelProvider}`);
  }
  if (sanitized.skepticModelProvider !== undefined && !VALID_PROVIDERS.has(sanitized.skepticModelProvider as AiLabModelProvider)) {
    throw new Error(`Invalid skepticModelProvider: ${sanitized.skepticModelProvider}`);
  }
  if (sanitized.mode !== undefined && !VALID_MODES.has(sanitized.mode as string)) {
    throw new Error(`Invalid mode: ${sanitized.mode}`);
  }
  if (sanitized.analystTemperature !== undefined) {
    const t = Number(sanitized.analystTemperature);
    if (!Number.isFinite(t)) throw new Error("analystTemperature must be a finite number");
    sanitized.analystTemperature = Math.max(0, Math.min(1, t));
  }
  if (sanitized.skepticTemperature !== undefined) {
    const t = Number(sanitized.skepticTemperature);
    if (!Number.isFinite(t)) throw new Error("skepticTemperature must be a finite number");
    sanitized.skepticTemperature = Math.max(0, Math.min(1, t));
  }
  if (sanitized.analystModelName !== undefined && typeof sanitized.analystModelName !== "string") {
    throw new Error("analystModelName must be a string");
  }
  if (sanitized.skepticModelName !== undefined && typeof sanitized.skepticModelName !== "string") {
    throw new Error("skepticModelName must be a string");
  }
  if (sanitized.enabled !== undefined && typeof sanitized.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }

  currentConfig = { ...currentConfig, ...(sanitized as Partial<AiLabStrategistConfig>) };
  return currentConfig;
}

export function resetAiLabStrategistConfig(): AiLabStrategistConfig {
  currentConfig = { ...DEFAULT_CONFIG };
  return currentConfig;
}
