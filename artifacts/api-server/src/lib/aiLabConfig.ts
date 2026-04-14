import { db, aiLabConfigTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export type AiLabModelProvider = "anthropic" | "google";

export interface AiLabStrategistConfig {
  analystModelProvider: AiLabModelProvider;
  analystModelName: string;
  analystTemperature: number;

  skepticModelProvider: AiLabModelProvider;
  skepticModelName: string;
  skepticTemperature: number;

  enabled: boolean;
}

const VALID_PROVIDERS = new Set<AiLabModelProvider>(["anthropic", "google"]);
const ALLOWED_KEYS = new Set([
  "analystModelProvider", "analystModelName", "analystTemperature",
  "skepticModelProvider", "skepticModelName", "skepticTemperature",
  "enabled",
]);

const DEFAULT_CONFIG: AiLabStrategistConfig = {
  analystModelProvider: "anthropic",
  analystModelName: "claude-sonnet-4-20250514",
  analystTemperature: 0,

  skepticModelProvider: "google",
  skepticModelName: "gemini-2.5-flash",
  skepticTemperature: 0,

  enabled: true,
};

let currentConfig: AiLabStrategistConfig = { ...DEFAULT_CONFIG };
let persistLock: Promise<void> = Promise.resolve();

function serializeValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function deserializeValue(key: string, raw: string): string | number | boolean {
  if (key.endsWith("Temperature")) return Number(raw);
  if (key === "enabled") return raw === "true";
  return raw;
}

function validateAndClamp(merged: Record<string, unknown>): AiLabStrategistConfig {
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
  const at = Number(merged.analystTemperature);
  if (Number.isFinite(at)) result.analystTemperature = Math.max(0, Math.min(1, at));
  const st = Number(merged.skepticTemperature);
  if (Number.isFinite(st)) result.skepticTemperature = Math.max(0, Math.min(1, st));
  if (typeof merged.enabled === "boolean") result.enabled = merged.enabled;

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

async function persistToDb(config: AiLabStrategistConfig): Promise<void> {
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

function queuePersist(config: AiLabStrategistConfig): void {
  persistLock = persistLock.then(() => persistToDb(config)).catch(() => {});
}

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

  queuePersist(currentConfig);

  return currentConfig;
}

export function resetAiLabStrategistConfig(): AiLabStrategistConfig {
  currentConfig = { ...DEFAULT_CONFIG };
  queuePersist(currentConfig);
  return currentConfig;
}
