import { db, eq } from "@workspace/db";
import { autoTradeConfigTable, type AutoTradeConfigRow } from "@workspace/db/schema";
import { normalizeAiModelId } from "@workspace/ai-models";
import { logger } from "../logger.js";

export type InstrumentMode = "stock" | "options" | "both";

export interface AutoTradeConfig {
  enabled: boolean;
  running: boolean;
  accountHash: string | null;
  modelId: string;
  tickers: string[];
  instrumentMode: InstrumentMode;
  totalBudget: number;
  maxPerTrade: number;
  dailyMaxLoss: number;
  pollIntervalSec: number;
  enableExtendedHours: boolean;
  flattenAtClose: boolean;
}

export const DEFAULT_AUTO_TRADE_CONFIG: AutoTradeConfig = {
  enabled: false,
  running: false,
  accountHash: null,
  modelId: "claude-opus-4-8",
  tickers: [],
  // Stock-only by default: options legs are logged but not yet executed, so a
  // "both" default would silently no-op call/put decisions.
  instrumentMode: "stock",
  // Scalping defaults tuned for a ~$1k account: allow up to ~3 concurrent
  // positions ($300 each), hard-stop the day at $100 (10%) drawdown.
  totalBudget: 1000,
  maxPerTrade: 300,
  dailyMaxLoss: 100,
  pollIntervalSec: 60,
  enableExtendedHours: false,
  flattenAtClose: true,
};

const POLL_MIN_SEC = 15;
const POLL_MAX_SEC = 900;

function normalizeInstrumentMode(value: unknown): InstrumentMode {
  return value === "stock" || value === "options" || value === "both" ? value : "both";
}

function normalizeTickers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const sym = raw.trim().toUpperCase();
    if (!sym || seen.has(sym) || !/^[A-Z.\-]{1,12}$/.test(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out.slice(0, 50);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function rowToConfig(row: AutoTradeConfigRow): AutoTradeConfig {
  return {
    enabled: row.enabled,
    running: row.running,
    accountHash: row.accountHash ?? null,
    modelId: normalizeAiModelId(row.modelId),
    tickers: normalizeTickers(row.tickers),
    instrumentMode: normalizeInstrumentMode(row.instrumentMode),
    totalBudget: row.totalBudget,
    maxPerTrade: row.maxPerTrade,
    dailyMaxLoss: row.dailyMaxLoss,
    pollIntervalSec: row.pollIntervalSec,
    enableExtendedHours: row.enableExtendedHours,
    flattenAtClose: row.flattenAtClose,
  };
}

export async function getAutoTradeConfig(userId: string): Promise<AutoTradeConfig> {
  try {
    const rows = await db
      .select()
      .from(autoTradeConfigTable)
      .where(eq(autoTradeConfigTable.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return { ...DEFAULT_AUTO_TRADE_CONFIG };
    return rowToConfig(row);
  } catch (err) {
    logger.warn({ err, userId }, "getAutoTradeConfig failed");
    return { ...DEFAULT_AUTO_TRADE_CONFIG };
  }
}

export async function saveAutoTradeConfig(
  userId: string,
  patch: Partial<AutoTradeConfig>,
): Promise<AutoTradeConfig> {
  const current = await getAutoTradeConfig(userId);
  const next: AutoTradeConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    running: typeof patch.running === "boolean" ? patch.running : current.running,
    accountHash:
      patch.accountHash !== undefined ? (patch.accountHash || null) : current.accountHash,
    modelId: patch.modelId !== undefined ? normalizeAiModelId(patch.modelId) : current.modelId,
    tickers: patch.tickers !== undefined ? normalizeTickers(patch.tickers) : current.tickers,
    instrumentMode:
      patch.instrumentMode !== undefined
        ? normalizeInstrumentMode(patch.instrumentMode)
        : current.instrumentMode,
    totalBudget:
      patch.totalBudget !== undefined
        ? clampNumber(patch.totalBudget, current.totalBudget, 1, 1_000_000)
        : current.totalBudget,
    maxPerTrade:
      patch.maxPerTrade !== undefined
        ? clampNumber(patch.maxPerTrade, current.maxPerTrade, 1, 1_000_000)
        : current.maxPerTrade,
    dailyMaxLoss:
      patch.dailyMaxLoss !== undefined
        ? clampNumber(patch.dailyMaxLoss, current.dailyMaxLoss, 1, 1_000_000)
        : current.dailyMaxLoss,
    pollIntervalSec:
      patch.pollIntervalSec !== undefined
        ? Math.round(clampNumber(patch.pollIntervalSec, current.pollIntervalSec, POLL_MIN_SEC, POLL_MAX_SEC))
        : current.pollIntervalSec,
    enableExtendedHours: typeof patch.enableExtendedHours === "boolean" ? patch.enableExtendedHours : current.enableExtendedHours,
    flattenAtClose: typeof patch.flattenAtClose === "boolean" ? patch.flattenAtClose : current.flattenAtClose,
  };

  await db
    .insert(autoTradeConfigTable)
    .values({
      userId,
      enabled: next.enabled,
      running: next.running,
      accountHash: next.accountHash,
      modelId: next.modelId,
      tickers: next.tickers,
      instrumentMode: next.instrumentMode,
      totalBudget: next.totalBudget,
      maxPerTrade: next.maxPerTrade,
      dailyMaxLoss: next.dailyMaxLoss,
      pollIntervalSec: next.pollIntervalSec,
      enableExtendedHours: next.enableExtendedHours,
      flattenAtClose: next.flattenAtClose,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: autoTradeConfigTable.userId,
      set: {
        enabled: next.enabled,
        running: next.running,
        accountHash: next.accountHash,
        modelId: next.modelId,
        tickers: next.tickers,
        instrumentMode: next.instrumentMode,
        totalBudget: next.totalBudget,
        maxPerTrade: next.maxPerTrade,
        dailyMaxLoss: next.dailyMaxLoss,
        pollIntervalSec: next.pollIntervalSec,
        enableExtendedHours: next.enableExtendedHours,
        flattenAtClose: next.flattenAtClose,
        updatedAt: new Date(),
      },
    });

  return next;
}

/** Flip just the running flag (used by start/stop without touching other fields). */
export async function setAutoTradeRunning(userId: string, running: boolean): Promise<void> {
  await saveAutoTradeConfig(userId, { running });
}
