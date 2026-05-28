import { db, aiLabConfigTable, aiLabPromptsTable } from "@workspace/db";
import { sql, eq, and, desc } from "@workspace/db";

export type AiLabModelProvider = "anthropic" | "google" | "openai" | "xai";

export interface AiLabFullConfig {
  analystModelProvider: AiLabModelProvider;
  analystModelName: string;
  analystTemperature: number;

  skepticModelProvider: AiLabModelProvider;
  skepticModelName: string;
  skepticTemperature: number;

  enabled: boolean;

  universe: string;

  maxDeliberationRounds: number;
  skepticCritiqueThreshold: number;
  overnightTopN: number;
  premarketTopN: number;
  triggerMinAvgVolume: number;
  priceShockMinMovePct: number;
  blockFlowMinNotional: number;
  scannerScoreMinDelta: number;

  anomalyVolumeSpikeThreshold: number;
  anomalyFlowStrengthThreshold: number;
  anomalyIvrSpikeThreshold: number;
  anomalyRsChangeThreshold: number;
  vixLow: number;
  vixNormal: number;
  anomalyMinPrice: number;
  anomalyMinAvgVolume20d: number;
  dataFreshnessMinutes: number;

  scheduleOvernightDigest: boolean;
  schedulePremarketPlan: boolean;
  schedulePostOpenCheck: boolean;
  scheduleMidMorningScan: boolean;
  scheduleMiddayRotation: boolean;
  schedulePowerHourPrep: boolean;
  schedulePostMarketReflection: boolean;

  validatorMaxActiveIdeas: number;
  validatorMinOiPerLeg: number;
  validatorMaxSpreadPct: number;
  validatorMinAvgVolumeStock: number;

  moversModelProvider: AiLabModelProvider;
  moversModelName: string;
  moversTemperature: number;
}

export type AiLabStrategistConfig = AiLabFullConfig;

const VALID_PROVIDERS = new Set<AiLabModelProvider>(["anthropic", "google", "openai", "xai"]);

const NUMERIC_KEYS = new Set([
  "analystTemperature", "skepticTemperature", "moversTemperature",
  "maxDeliberationRounds", "skepticCritiqueThreshold",
  "overnightTopN", "premarketTopN",
  "triggerMinAvgVolume", "priceShockMinMovePct",
  "blockFlowMinNotional", "scannerScoreMinDelta",
  "anomalyVolumeSpikeThreshold", "anomalyFlowStrengthThreshold",
  "anomalyIvrSpikeThreshold", "anomalyRsChangeThreshold",
  "vixLow", "vixNormal", "anomalyMinPrice",
  "anomalyMinAvgVolume20d", "dataFreshnessMinutes",
  "validatorMaxActiveIdeas", "validatorMinOiPerLeg",
  "validatorMaxSpreadPct", "validatorMinAvgVolumeStock",
]);

const BOOLEAN_KEYS = new Set([
  "enabled",
  "scheduleOvernightDigest", "schedulePremarketPlan",
  "schedulePostOpenCheck", "scheduleMidMorningScan",
  "scheduleMiddayRotation", "schedulePowerHourPrep",
  "schedulePostMarketReflection",
]);

type AiLabBooleanKey =
  | "enabled"
  | "scheduleOvernightDigest"
  | "schedulePremarketPlan"
  | "schedulePostOpenCheck"
  | "scheduleMidMorningScan"
  | "scheduleMiddayRotation"
  | "schedulePowerHourPrep"
  | "schedulePostMarketReflection";

type AiLabNumericConfigKey =
  | "maxDeliberationRounds"
  | "skepticCritiqueThreshold"
  | "overnightTopN"
  | "premarketTopN"
  | "triggerMinAvgVolume"
  | "priceShockMinMovePct"
  | "blockFlowMinNotional"
  | "scannerScoreMinDelta"
  | "anomalyVolumeSpikeThreshold"
  | "anomalyFlowStrengthThreshold"
  | "anomalyIvrSpikeThreshold"
  | "anomalyRsChangeThreshold"
  | "vixLow"
  | "vixNormal"
  | "anomalyMinPrice"
  | "anomalyMinAvgVolume20d"
  | "dataFreshnessMinutes"
  | "validatorMaxActiveIdeas"
  | "validatorMinOiPerLeg"
  | "validatorMaxSpreadPct"
  | "validatorMinAvgVolumeStock";

const STRING_KEYS = new Set([
  "analystModelProvider", "analystModelName",
  "skepticModelProvider", "skepticModelName",
  "moversModelProvider", "moversModelName",
  "universe",
]);

const ALLOWED_KEYS = new Set([...NUMERIC_KEYS, ...BOOLEAN_KEYS, ...STRING_KEYS]);

export const DEFAULT_CONFIG: AiLabFullConfig = {
  analystModelProvider: "anthropic",
  analystModelName: "claude-opus-4-8",
  analystTemperature: 0,

  skepticModelProvider: "google",
  skepticModelName: "gemini-3.1-pro-preview",
  skepticTemperature: 0,

  enabled: true,

  universe: "LIQUID_CORE",

  maxDeliberationRounds: 20,
  skepticCritiqueThreshold: 25,
  overnightTopN: 50,
  premarketTopN: 10,
  triggerMinAvgVolume: 500000,
  priceShockMinMovePct: 3.0,
  blockFlowMinNotional: 500000,
  scannerScoreMinDelta: 15,

  anomalyVolumeSpikeThreshold: 1.8,
  anomalyFlowStrengthThreshold: 1.5,
  anomalyIvrSpikeThreshold: 60,
  anomalyRsChangeThreshold: 0.03,
  vixLow: 15,
  vixNormal: 20,
  anomalyMinPrice: 5,
  anomalyMinAvgVolume20d: 500000,
  dataFreshnessMinutes: 30,

  scheduleOvernightDigest: true,
  schedulePremarketPlan: true,
  schedulePostOpenCheck: true,
  scheduleMidMorningScan: true,
  scheduleMiddayRotation: true,
  schedulePowerHourPrep: true,
  schedulePostMarketReflection: true,

  validatorMaxActiveIdeas: 20,
  validatorMinOiPerLeg: 50,
  validatorMaxSpreadPct: 0.10,
  validatorMinAvgVolumeStock: 100000,

  moversModelProvider: "anthropic",
  moversModelName: "claude-sonnet-4-6",
  moversTemperature: 0,
};

let currentConfig: AiLabFullConfig = { ...DEFAULT_CONFIG };
let persistLock: Promise<void> = Promise.resolve();

function serializeValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function deserializeValue(key: string, raw: string): string | number | boolean {
  if (NUMERIC_KEYS.has(key)) return Number(raw);
  if (BOOLEAN_KEYS.has(key)) return raw === "true";
  return raw;
}

function validateAndClamp(merged: Record<string, unknown>): AiLabFullConfig {
  const result = { ...DEFAULT_CONFIG };

  if (typeof merged.analystModelProvider === "string" && VALID_PROVIDERS.has(merged.analystModelProvider as AiLabModelProvider)) {
    result.analystModelProvider = merged.analystModelProvider as AiLabModelProvider;
  }
  if (typeof merged.skepticModelProvider === "string" && VALID_PROVIDERS.has(merged.skepticModelProvider as AiLabModelProvider)) {
    result.skepticModelProvider = merged.skepticModelProvider as AiLabModelProvider;
  }
  if (typeof merged.analystModelName === "string" && merged.analystModelName.length > 0) {
    result.analystModelName = merged.analystModelName;
  }
  if (typeof merged.skepticModelName === "string" && merged.skepticModelName.length > 0) {
    result.skepticModelName = merged.skepticModelName;
  }
  if (typeof merged.moversModelProvider === "string" && VALID_PROVIDERS.has(merged.moversModelProvider as AiLabModelProvider)) {
    result.moversModelProvider = merged.moversModelProvider as AiLabModelProvider;
  }
  if (typeof merged.moversModelName === "string" && merged.moversModelName.length > 0) {
    result.moversModelName = merged.moversModelName;
  }

  const at = Number(merged.analystTemperature);
  if (Number.isFinite(at)) result.analystTemperature = Math.max(0, Math.min(1, at));
  const st = Number(merged.skepticTemperature);
  if (Number.isFinite(st)) result.skepticTemperature = Math.max(0, Math.min(1, st));
  const mt = Number(merged.moversTemperature);
  if (Number.isFinite(mt)) result.moversTemperature = Math.max(0, Math.min(1, mt));

  if (typeof merged.enabled === "boolean") result.enabled = merged.enabled;

  if (typeof merged.universe === "string" && merged.universe.length > 0) {
    result.universe = merged.universe;
  }

  const numericClamps: Record<string, { min: number; max: number; key: AiLabNumericConfigKey }> = {
    maxDeliberationRounds: { min: 1, max: 50, key: "maxDeliberationRounds" },
    skepticCritiqueThreshold: { min: 0, max: 100, key: "skepticCritiqueThreshold" },
    overnightTopN: { min: 1, max: 200, key: "overnightTopN" },
    premarketTopN: { min: 1, max: 50, key: "premarketTopN" },
    triggerMinAvgVolume: { min: 0, max: 100000000, key: "triggerMinAvgVolume" },
    priceShockMinMovePct: { min: 0.1, max: 20, key: "priceShockMinMovePct" },
    blockFlowMinNotional: { min: 0, max: 100000000, key: "blockFlowMinNotional" },
    scannerScoreMinDelta: { min: 0, max: 100, key: "scannerScoreMinDelta" },
    anomalyVolumeSpikeThreshold: { min: 1, max: 10, key: "anomalyVolumeSpikeThreshold" },
    anomalyFlowStrengthThreshold: { min: 0.1, max: 10, key: "anomalyFlowStrengthThreshold" },
    anomalyIvrSpikeThreshold: { min: 0, max: 100, key: "anomalyIvrSpikeThreshold" },
    anomalyRsChangeThreshold: { min: 0.001, max: 1, key: "anomalyRsChangeThreshold" },
    vixLow: { min: 5, max: 40, key: "vixLow" },
    vixNormal: { min: 10, max: 60, key: "vixNormal" },
    anomalyMinPrice: { min: 0, max: 100, key: "anomalyMinPrice" },
    anomalyMinAvgVolume20d: { min: 0, max: 100000000, key: "anomalyMinAvgVolume20d" },
    dataFreshnessMinutes: { min: 1, max: 1440, key: "dataFreshnessMinutes" },
    validatorMaxActiveIdeas: { min: 1, max: 50, key: "validatorMaxActiveIdeas" },
    validatorMinOiPerLeg: { min: 10, max: 1000, key: "validatorMinOiPerLeg" },
    validatorMaxSpreadPct: { min: 0.01, max: 1, key: "validatorMaxSpreadPct" },
    validatorMinAvgVolumeStock: { min: 0, max: 10000000, key: "validatorMinAvgVolumeStock" },
  };

  for (const [field, { min, max, key }] of Object.entries(numericClamps)) {
    const v = Number(merged[field]);
    if (Number.isFinite(v)) {
      result[key] = Math.max(min, Math.min(max, v));
    }
  }

  for (const boolKey of BOOLEAN_KEYS) {
    const v = merged[boolKey as AiLabBooleanKey];
    if (typeof v !== "boolean") continue;
    switch (boolKey as AiLabBooleanKey) {
      case "enabled":
        result.enabled = v;
        break;
      case "scheduleOvernightDigest":
        result.scheduleOvernightDigest = v;
        break;
      case "schedulePremarketPlan":
        result.schedulePremarketPlan = v;
        break;
      case "schedulePostOpenCheck":
        result.schedulePostOpenCheck = v;
        break;
      case "scheduleMidMorningScan":
        result.scheduleMidMorningScan = v;
        break;
      case "scheduleMiddayRotation":
        result.scheduleMiddayRotation = v;
        break;
      case "schedulePowerHourPrep":
        result.schedulePowerHourPrep = v;
        break;
      case "schedulePostMarketReflection":
        result.schedulePostMarketReflection = v;
        break;
      default:
        break;
    }
  }

  return result;
}

export async function loadAiLabConfigFromDb(): Promise<void> {
  try {
    const rows = await db.select().from(aiLabConfigTable);
    if (rows.length > 0) {
      const merged: Record<string, unknown> = {};
      for (const row of rows) {
        if (ALLOWED_KEYS.has(row.key)) {
          merged[row.key] = deserializeValue(row.key, row.value);
        }
      }
      currentConfig = validateAndClamp(merged);
    }
    console.log("[AI Lab Config] Loaded from DB:", JSON.stringify(currentConfig));
  } catch (err) {
    console.error("[AI Lab Config] Failed to load from DB, using defaults:", err);
  }
}

async function persistToDb(config: AiLabFullConfig): Promise<void> {
  const entries = Object.entries(config).filter(([k]) => ALLOWED_KEYS.has(k));
  const values = entries.map(([key, value]) => `('${key}', '${serializeValue(value).replace(/'/g, "''")}', NOW())`).join(", ");

  try {
    await db.execute(sql.raw(
      `INSERT INTO ai_lab_config (key, value, updated_at) VALUES ${values}
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
    ));
  } catch (err) {
    console.error("[AI Lab Config] Failed to persist to DB:", err);
  }
}

function queuePersist(config: AiLabFullConfig): void {
  persistLock = persistLock.then(() => persistToDb(config)).catch(() => {});
}

export function getAiLabStrategistConfig(): Readonly<AiLabFullConfig> {
  return currentConfig;
}

export function getAiLabFullConfig(): Readonly<AiLabFullConfig> {
  return currentConfig;
}

export function getMoversAiConfig(): Readonly<{
  provider: AiLabModelProvider;
  modelName: string;
  temperature: number;
}> {
  const cfg = currentConfig;
  return {
    provider: cfg.moversModelProvider,
    modelName: cfg.moversModelName,
    temperature: cfg.moversTemperature,
  };
}

export function getAiLabConfigDefaults(): Readonly<AiLabFullConfig> {
  return DEFAULT_CONFIG;
}

export function updateAiLabStrategistConfig(
  partial: Partial<AiLabFullConfig>,
): AiLabFullConfig {
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
  if (sanitized.moversModelProvider !== undefined && !VALID_PROVIDERS.has(sanitized.moversModelProvider as AiLabModelProvider)) {
    throw new Error(`Invalid moversModelProvider: ${sanitized.moversModelProvider}`);
  }

  for (const numKey of NUMERIC_KEYS) {
    if (sanitized[numKey] !== undefined) {
      const t = Number(sanitized[numKey]);
      if (!Number.isFinite(t)) throw new Error(`${numKey} must be a finite number`);
      sanitized[numKey] = t;
    }
  }

  for (const strKey of ["analystModelName", "skepticModelName", "moversModelName", "universe"]) {
    if (sanitized[strKey] !== undefined && typeof sanitized[strKey] !== "string") {
      throw new Error(`${strKey} must be a string`);
    }
  }

  for (const boolKey of BOOLEAN_KEYS) {
    if (sanitized[boolKey] !== undefined && typeof sanitized[boolKey] !== "boolean") {
      throw new Error(`${boolKey} must be a boolean`);
    }
  }

  currentConfig = validateAndClamp({ ...currentConfig, ...sanitized });
  queuePersist(currentConfig);
  return currentConfig;
}

export function resetAiLabStrategistConfig(): AiLabFullConfig {
  currentConfig = { ...DEFAULT_CONFIG };
  queuePersist(currentConfig);
  return currentConfig;
}

export const PROMPT_ROLES = [
  "shared_context",
  "analyst",
  "analyst_rebuttal",
  "skeptic",
  "skeptic_reeval",
  "universe_screener",
] as const;

export type PromptRole = typeof PROMPT_ROLES[number];

export async function getActivePrompt(role: PromptRole): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(aiLabPromptsTable)
      .where(and(eq(aiLabPromptsTable.role, role), eq(aiLabPromptsTable.isActive, true)))
      .orderBy(desc(aiLabPromptsTable.createdAt))
      .limit(1);
    return row?.promptText ?? null;
  } catch {
    return null;
  }
}

export async function getAllActivePrompts(): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  for (const role of PROMPT_ROLES) {
    result[role] = await getActivePrompt(role);
  }
  return result;
}

export async function getPromptHistory(role: PromptRole, limit = 20): Promise<Array<{
  id: number;
  role: string;
  promptText: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
}>> {
  try {
    return await db
      .select()
      .from(aiLabPromptsTable)
      .where(eq(aiLabPromptsTable.role, role))
      .orderBy(desc(aiLabPromptsTable.createdAt))
      .limit(limit);
  } catch {
    return [];
  }
}

export async function savePrompt(role: PromptRole, promptText: string): Promise<{ id: number }> {
  await db
    .update(aiLabPromptsTable)
    .set({ isActive: false })
    .where(and(eq(aiLabPromptsTable.role, role), eq(aiLabPromptsTable.isActive, true)));

  const [inserted] = await db
    .insert(aiLabPromptsTable)
    .values({ role, promptText, isActive: true, isDefault: false })
    .returning();

  return { id: inserted.id };
}

export async function resetPromptToDefault(role: PromptRole): Promise<void> {
  await db
    .update(aiLabPromptsTable)
    .set({ isActive: false })
    .where(and(eq(aiLabPromptsTable.role, role), eq(aiLabPromptsTable.isActive, true)));
}

export async function restorePrompt(promptId: number): Promise<boolean> {
  const [row] = await db
    .select()
    .from(aiLabPromptsTable)
    .where(eq(aiLabPromptsTable.id, promptId))
    .limit(1);

  if (!row) return false;

  await db
    .update(aiLabPromptsTable)
    .set({ isActive: false })
    .where(and(eq(aiLabPromptsTable.role, row.role), eq(aiLabPromptsTable.isActive, true)));

  await db
    .update(aiLabPromptsTable)
    .set({ isActive: true })
    .where(eq(aiLabPromptsTable.id, promptId));

  return true;
}

export const SETTINGS_META = [
  { key: "analystTemperature", label: "Analyst Temperature", group: "Models", type: "slider", min: 0, max: 1, step: 0.05, description: "Creativity level for the Analyst LLM (0 = deterministic, 1 = creative)" },
  { key: "skepticTemperature", label: "Skeptic Temperature", group: "Models", type: "slider", min: 0, max: 1, step: 0.05, description: "Creativity level for the Skeptic LLM" },

  { key: "maxDeliberationRounds", label: "Max Deliberation Rounds", group: "Deliberation", type: "slider", min: 1, max: 50, step: 1, description: "Maximum rounds of Analyst-Skeptic back-and-forth" },
  { key: "skepticCritiqueThreshold", label: "Skeptic Critique Threshold", group: "Deliberation", type: "slider", min: 0, max: 100, step: 1, description: "Skeptic score above this triggers deliberation rounds" },
  { key: "overnightTopN", label: "Overnight Top-N Picks", group: "Deliberation", type: "number", min: 1, max: 200, step: 1, description: "Number of top anomalies processed in the overnight pass" },
  { key: "premarketTopN", label: "Premarket Top-N Picks", group: "Deliberation", type: "number", min: 1, max: 50, step: 1, description: "Number of top anomalies processed in the premarket pass" },
  { key: "triggerMinAvgVolume", label: "Trigger Min Avg Volume", group: "Deliberation", type: "number", min: 0, max: 100000000, step: 50000, description: "Minimum 20-day average volume to qualify for pipeline" },
  { key: "priceShockMinMovePct", label: "Price Shock Min Move %", group: "Deliberation", type: "slider", min: 0.1, max: 20, step: 0.1, description: "Minimum % move to trigger a price shock pipeline run" },
  { key: "blockFlowMinNotional", label: "Block Flow Min Notional", group: "Deliberation", type: "number", min: 0, max: 100000000, step: 50000, description: "Minimum block trade notional to trigger pipeline" },
  { key: "scannerScoreMinDelta", label: "Scanner Score Min Delta", group: "Deliberation", type: "slider", min: 0, max: 100, step: 1, description: "Minimum scanner score jump to trigger pipeline" },

  { key: "anomalyVolumeSpikeThreshold", label: "Volume Spike Threshold", group: "Anomaly Detection", type: "slider", min: 1, max: 10, step: 0.1, description: "Volume/20d median ratio that flags a volume spike" },
  { key: "anomalyFlowStrengthThreshold", label: "Flow Strength Threshold", group: "Anomaly Detection", type: "slider", min: 0.1, max: 10, step: 0.1, description: "Options vol/OI ratio threshold for unusual flow" },
  { key: "anomalyIvrSpikeThreshold", label: "IVR Spike Threshold", group: "Anomaly Detection", type: "slider", min: 0, max: 100, step: 1, description: "IV Rank above this is flagged as a spike" },
  { key: "anomalyRsChangeThreshold", label: "RS Change Threshold", group: "Anomaly Detection", type: "slider", min: 0.001, max: 1, step: 0.005, description: "Relative strength divergence threshold from 1.0" },
  { key: "vixLow", label: "VIX Low Boundary", group: "Anomaly Detection", type: "number", min: 5, max: 40, step: 1, description: "VIX below this = LOW_VOL regime" },
  { key: "vixNormal", label: "VIX Normal Boundary", group: "Anomaly Detection", type: "number", min: 10, max: 60, step: 1, description: "VIX above this = HIGH_VOL regime" },
  { key: "anomalyMinPrice", label: "Min Price Filter", group: "Anomaly Detection", type: "number", min: 0, max: 100, step: 1, description: "Minimum stock price for universe inclusion" },
  { key: "anomalyMinAvgVolume20d", label: "Min Avg Volume 20D", group: "Anomaly Detection", type: "number", min: 0, max: 100000000, step: 50000, description: "Minimum 20-day average volume for universe inclusion" },
  { key: "dataFreshnessMinutes", label: "Data Freshness (minutes)", group: "Anomaly Detection", type: "slider", min: 1, max: 1440, step: 5, description: "Max age of data before considered stale" },

  { key: "validatorMaxActiveIdeas", label: "Max Active Ideas", group: "Trade Validation", type: "number", min: 1, max: 50, step: 1, description: "Maximum number of concurrent active trade ideas before new ideas are blocked" },
  { key: "validatorMinOiPerLeg", label: "Min Open Interest Per Leg", group: "Trade Validation", type: "number", min: 10, max: 1000, step: 10, description: "Minimum open interest required for each options leg" },
  { key: "validatorMaxSpreadPct", label: "Max Bid-Ask Spread %", group: "Trade Validation", type: "slider", min: 0.01, max: 1, step: 0.01, description: "Maximum bid-ask spread percentage before trade is rejected as untradeable" },
  { key: "validatorMinAvgVolumeStock", label: "Min Avg Daily Volume (Stock)", group: "Trade Validation", type: "number", min: 0, max: 10000000, step: 10000, description: "Minimum average daily volume for stock-only trades" },
];
