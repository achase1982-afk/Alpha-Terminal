import { db, strategistSettingsTable } from "@workspace/db";
import { logger } from "./logger.js";

export interface StrategistConfig {
  ioWeightR2: number;
  ioWeightResidual: number;
  ioWeightCatalyst: number;
  ioWeightFlow: number;
  ioThresholdHigh: number;
  ioThresholdMixed: number;
  betaR2Lookback: number;
  residualReturnLookback: number;
  scannerDefaultTrend: number;
  scannerDefaultRS: number;
  scannerDefaultVolume: number;
  scannerDefaultIVR: number;
  scannerDefaultLiquidity: number;
  scannerIdioTrend: number;
  scannerIdioRS: number;
  scannerIdioVolume: number;
  scannerIdioIVR: number;
  scannerIdioLiquidity: number;
  catalystBonusPoints: number;
  scannerMinScore: number;
  preferredDteMin: number;
  preferredDteMax: number;
  spreadWidth: number;
  /** 1 = unlimited (agents may pick any width); 0 = honor spreadWidth as a hard cap. */
  spreadWidthUnlimited: number;
  minOpenInterest: number;
  maxBidAskSpreadPct: number;
  earningsSuppressDays: number;
  earningsInsideExpiryBehavior: number;
  noEdgeGateBehavior: number;
  correlationLowCeiling: number;
  correlationHighFloor: number;
  toxicGateEnabled: number;
  toxicPathAEnabled: number;
  toxicPathBEnabled: number;
  regimeUpdateFrequencyMin: number;
  // Strategist mode + model selection
  strategistMode: number; // 1 = Solo, 2 = Debate, 3 = Desk
  strategistConvergence: number; // 1 = highest_confidence, 2 = synthesis, 3 = hybrid
  /** Confidence-point gap (Bull − Bear) below which the verdict is SIDEWAYS.
   *  Smaller = more directional verdicts; larger = more SIDEWAYS / vol-neutral. */
  strategistTieBand: number;
  strategistSoloModelIdx: number;
  strategistDebateAModelIdx: number;
  strategistDebateBModelIdx: number;
  strategistArbitratorModelIdx: number;
  /**
   * Bumped when the strategist model catalog changes shape; used to remap
   * persisted integer indices once after upgrades.
   */
  strategistModelCatalogVersion: number;
}

// Model catalog used by the strategist. Stored as an integer index in the
// settings table (which is number-only) to avoid a schema migration.
export interface StrategistModelOption {
  provider: "anthropic" | "google" | "openai" | "xai";
  model: string;
  label: string;
}

/** Six-model strategist catalog (indices 0–5). */
export const STRATEGIST_MODEL_OPTIONS: StrategistModelOption[] = [
  { provider: "anthropic", model: "claude-opus-4-7", label: "Claude Opus 4.7 (Anthropic)" },
  { provider: "openai", model: "gpt-5.5", label: "GPT-5.5 + Thinking (OpenAI)" },
  { provider: "openai", model: "gpt-5.4-mini", label: "GPT-5.4 Mini (OpenAI)" },
  { provider: "google", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Google)" },
  { provider: "google", model: "gemini-3-flash-preview", label: "Gemini 3 Flash (Google)" },
  { provider: "xai", model: "grok-4-1-fast-reasoning", label: "Grok 4.1 fast reasoning (xAI)" },
];

/** Current catalog version written to `strategistModelCatalogVersion`. */
export const STRATEGIST_MODEL_CATALOG_VERSION = 4;

/**
 * Maps pre–four-model catalog indices (the former `STRATEGIST_MODEL_OPTIONS`
 * order) to the new 0–5 index. Used for one-time DB migration.
 * Anthropic slots (non–Opus 4.7) → 0; OpenAI (non–5.5) → 1; Gemini (non–3.1 Pro) → 3;
 * xAI (non–Grok 4.20 multi-agent snapshot) → 5.
 */
const LEGACY_STRATEGIST_MODEL_INDEX_TO_NEW: readonly number[] = [
  0, 2, 0, 2, 0, 2, 1, 1, 1, 1, 1, 1, 1, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
];

function remapLegacyStrategistModelIdx(idx: number): number {
  if (!Number.isFinite(idx) || idx < 0) return 0;
  const i = Math.floor(idx);
  if (i < LEGACY_STRATEGIST_MODEL_INDEX_TO_NEW.length) {
    return LEGACY_STRATEGIST_MODEL_INDEX_TO_NEW[i]!;
  }
  return 0;
}

export function normalizeStrategistModelIndex(idx: number): number {
  if (!Number.isFinite(idx) || idx < 0 || idx >= STRATEGIST_MODEL_OPTIONS.length) {
    return 0;
  }
  return Math.floor(idx);
}

export function getStrategistModel(idx: number): StrategistModelOption {
  return STRATEGIST_MODEL_OPTIONS[normalizeStrategistModelIndex(idx)];
}

/**
 * Sentinel arbitrator-idx meaning "the model whose side won the directional
 * verdict in Phase 1 is promoted to Senior PM for Phase 3". When the arbitrator
 * setting equals this value, strategistDebate resolves the arbitrator
 * dynamically from the verdict instead of from STRATEGIST_MODEL_OPTIONS.
 */
export const ARBITRATOR_IDX_DEBATE_WINNER = -1;
export function isDebateWinnerArbitrator(idx: number): boolean {
  return idx === ARBITRATOR_IDX_DEBATE_WINNER;
}

const DEFAULTS = {
  ioWeightR2: 0.30,
  ioWeightResidual: 0.25,
  ioWeightCatalyst: 0.25,
  ioWeightFlow: 0.20,
  ioThresholdHigh: 0.65,
  ioThresholdMixed: 0.40,
  betaR2Lookback: 30,
  residualReturnLookback: 10,
  scannerDefaultTrend: 25,
  scannerDefaultRS: 20,
  scannerDefaultVolume: 20,
  scannerDefaultIVR: 20,
  scannerDefaultLiquidity: 15,
  scannerIdioTrend: 15,
  scannerIdioRS: 25,
  scannerIdioVolume: 25,
  scannerIdioIVR: 20,
  scannerIdioLiquidity: 15,
  catalystBonusPoints: 10,
  scannerMinScore: 55,
  preferredDteMin: 30,
  preferredDteMax: 60,
  spreadWidth: 5,
  spreadWidthUnlimited: 1,
  minOpenInterest: 50,
  maxBidAskSpreadPct: 25,
  earningsSuppressDays: 14,
  earningsInsideExpiryBehavior: 2,
  noEdgeGateBehavior: 2,
  correlationLowCeiling: 0.40,
  correlationHighFloor: 0.75,
  toxicGateEnabled: 1,
  toxicPathAEnabled: 1,
  toxicPathBEnabled: 1,
  regimeUpdateFrequencyMin: 5,
  strategistMode: 1,
  strategistConvergence: 3,
  strategistTieBand: 10,
  strategistSoloModelIdx: 0,
  strategistDebateAModelIdx: 0,
  strategistDebateBModelIdx: 1,
  strategistArbitratorModelIdx: 0,
  strategistModelCatalogVersion: STRATEGIST_MODEL_CATALOG_VERSION,
} satisfies StrategistConfig;

let settingsCache: StrategistConfig | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 60_000;

/** Serialize concurrent loads so migration + cache populate run once (avoids duplicate upserts under load). */
let settingsLoadInFlight: Promise<StrategistConfig> | null = null;

function isStrategistConfigKey(key: string): key is keyof StrategistConfig {
  return key in DEFAULTS;
}

async function migrateStrategistModelCatalogIfNeeded(
  rows: { key: string; value: number }[],
  merged: StrategistConfig,
): Promise<void> {
  const sawCatalogVersion = rows.some((r) => r.key === "strategistModelCatalogVersion");
  if (rows.length === 0 || sawCatalogVersion) {
    return;
  }
  const solo = remapLegacyStrategistModelIdx(merged.strategistSoloModelIdx);
  const debateA = remapLegacyStrategistModelIdx(merged.strategistDebateAModelIdx);
  const debateB = remapLegacyStrategistModelIdx(merged.strategistDebateBModelIdx);
  const arbRaw = merged.strategistArbitratorModelIdx;
  const arbitrator =
    arbRaw === ARBITRATOR_IDX_DEBATE_WINNER ? ARBITRATOR_IDX_DEBATE_WINNER : remapLegacyStrategistModelIdx(arbRaw);

  const now = new Date();
  const upserts: Array<{ key: string; value: number }> = [
    { key: "strategistSoloModelIdx", value: solo },
    { key: "strategistDebateAModelIdx", value: debateA },
    { key: "strategistDebateBModelIdx", value: debateB },
    { key: "strategistArbitratorModelIdx", value: arbitrator },
    { key: "strategistModelCatalogVersion", value: STRATEGIST_MODEL_CATALOG_VERSION },
  ];

  await db.transaction(async (tx) => {
    const inner = await tx.select().from(strategistSettingsTable);
    if (inner.some((r) => r.key === "strategistModelCatalogVersion")) {
      return;
    }
    for (const { key, value } of upserts) {
      await tx
        .insert(strategistSettingsTable)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: strategistSettingsTable.key,
          set: { value, updatedAt: now },
        });
    }
  });

  logger.info(
    { solo, debateA, debateB, arbitrator },
    "Strategist settings: migrated model indices to four-model catalog (single transaction)",
  );
}

/** v2 used Grok 4.20 reasoning at index 3; v3 swaps to multi-agent at the same index — only bump the stored version. */
async function bumpStrategistModelCatalogV2ToV3IfNeeded(merged: StrategistConfig): Promise<boolean> {
  if (merged.strategistModelCatalogVersion !== 2) {
    return false;
  }
  const now = new Date();
  await db
    .insert(strategistSettingsTable)
    .values({ key: "strategistModelCatalogVersion", value: 3, updatedAt: now })
    .onConflictDoUpdate({
      target: strategistSettingsTable.key,
      set: { value: 3, updatedAt: now },
    });
  logger.info(
    { from: 2, to: 3 },
    "Strategist settings: catalog version bump (Grok reasoning -> multi-agent, indices unchanged)",
  );
  return true;
}

/** v4 adds GPT-5.4 Mini and Gemini 3 Flash; replaces xAI slot with grok-4-1-fast-reasoning. */
async function migrateStrategistModelCatalogV3ToV4IfNeeded(merged: StrategistConfig): Promise<boolean> {
  if (merged.strategistModelCatalogVersion !== 3) {
    return false;
  }
  const now = new Date();
  const remapIdx = (idx: number): number => {
    if (idx === 2) return 3; // was Gemini 3.1 Pro → still Gemini 3.1 Pro
    if (idx === 3) return 5; // was xAI → still xAI slot (new model id)
    return idx;
  };
  const solo = remapIdx(normalizeStrategistModelIndex(merged.strategistSoloModelIdx));
  const debateA = remapIdx(normalizeStrategistModelIndex(merged.strategistDebateAModelIdx));
  const debateB = remapIdx(normalizeStrategistModelIndex(merged.strategistDebateBModelIdx));
  const arbRaw = merged.strategistArbitratorModelIdx;
  const arbitrator =
    arbRaw === ARBITRATOR_IDX_DEBATE_WINNER ? ARBITRATOR_IDX_DEBATE_WINNER : remapIdx(normalizeStrategistModelIndex(arbRaw));

  await db.transaction(async (tx) => {
    const inner = await tx.select().from(strategistSettingsTable);
    if (inner.some((r) => r.key === "strategistModelCatalogVersion" && r.value >= STRATEGIST_MODEL_CATALOG_VERSION)) {
      return;
    }
    const upserts: Array<{ key: string; value: number }> = [
      { key: "strategistSoloModelIdx", value: solo },
      { key: "strategistDebateAModelIdx", value: debateA },
      { key: "strategistDebateBModelIdx", value: debateB },
      { key: "strategistArbitratorModelIdx", value: arbitrator },
      { key: "strategistModelCatalogVersion", value: STRATEGIST_MODEL_CATALOG_VERSION },
    ];
    for (const { key, value } of upserts) {
      await tx
        .insert(strategistSettingsTable)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: strategistSettingsTable.key,
          set: { value, updatedAt: now },
        });
    }
  });

  logger.info(
    { solo, debateA, debateB, arbitrator, from: 3, to: STRATEGIST_MODEL_CATALOG_VERSION },
    "Strategist settings: migrated model indices to six-model catalog (v4)",
  );
  return true;
}

export async function getSettings(): Promise<StrategistConfig> {
  if (settingsCache && Date.now() - cacheTs < CACHE_TTL_MS) {
    return settingsCache;
  }
  if (settingsLoadInFlight) {
    return settingsLoadInFlight;
  }

  settingsLoadInFlight = (async (): Promise<StrategistConfig> => {
    const t0 = performance.now();
    try {
      const tSelect0 = performance.now();
      const rows = await db.select().from(strategistSettingsTable);
      const selectMs = Math.round(performance.now() - tSelect0);

      const merged: StrategistConfig = { ...DEFAULTS };
      for (const row of rows) {
        if (isStrategistConfigKey(row.key)) {
          merged[row.key] = row.value;
        }
      }

      const tMig0 = performance.now();
      await migrateStrategistModelCatalogIfNeeded(rows, merged);
      const migMs = Math.round(performance.now() - tMig0);

      const needsReselect =
        rows.length > 0 && !rows.some((r) => r.key === "strategistModelCatalogVersion");
      const tSelect2 = performance.now();
      let rowsAfter = needsReselect ? await db.select().from(strategistSettingsTable) : rows;
      const select2Ms = needsReselect ? Math.round(performance.now() - tSelect2) : 0;

      const mergedAfter: StrategistConfig = { ...DEFAULTS };
      for (const row of rowsAfter) {
        if (isStrategistConfigKey(row.key)) {
          mergedAfter[row.key] = row.value;
        }
      }
      const tBump0 = performance.now();
      const bumpedV3 = await bumpStrategistModelCatalogV2ToV3IfNeeded(mergedAfter);
      const bumpMs = Math.round(performance.now() - tBump0);
      if (bumpedV3) {
        mergedAfter.strategistModelCatalogVersion = 3;
      }

      const tBumpV4 = performance.now();
      const bumpedV4 = await migrateStrategistModelCatalogV3ToV4IfNeeded(mergedAfter);
      const bumpV4Ms = Math.round(performance.now() - tBumpV4);
      if (bumpedV4) {
        mergedAfter.strategistModelCatalogVersion = STRATEGIST_MODEL_CATALOG_VERSION;
      }

      const rowsFinal = bumpedV4 ? await db.select().from(strategistSettingsTable) : rowsAfter;

      const finalMerged: StrategistConfig = { ...DEFAULTS };
      for (const row of rowsFinal) {
        if (isStrategistConfigKey(row.key)) {
          finalMerged[row.key] = row.value;
        }
      }
      if (bumpedV3 && !bumpedV4) {
        finalMerged.strategistModelCatalogVersion = 3;
      }
      finalMerged.strategistSoloModelIdx = normalizeStrategistModelIndex(finalMerged.strategistSoloModelIdx);
      finalMerged.strategistDebateAModelIdx = normalizeStrategistModelIndex(finalMerged.strategistDebateAModelIdx);
      finalMerged.strategistDebateBModelIdx = normalizeStrategistModelIndex(finalMerged.strategistDebateBModelIdx);
      if (!isDebateWinnerArbitrator(finalMerged.strategistArbitratorModelIdx)) {
        finalMerged.strategistArbitratorModelIdx = normalizeStrategistModelIndex(finalMerged.strategistArbitratorModelIdx);
      }
      settingsCache = finalMerged;
      cacheTs = Date.now();

      const totalMs = Math.round(performance.now() - t0);
      if (totalMs > 200 || migMs > 0 || bumpMs > 0 || bumpV4Ms > 0) {
        logger.info(
          {
            rowCount: rows.length,
            selectMs,
            migrationMs: migMs,
            bumpV3Ms: bumpMs,
            bumpV4Ms: bumpV4Ms,
            secondSelectMs: select2Ms,
            totalMs,
            catalogVersion: finalMerged.strategistModelCatalogVersion,
          },
          "Strategist settings: getSettings timing",
        );
      }
      return finalMerged;
    } catch (err) {
      logger.error({ err }, "Failed to load strategist settings, using defaults");
      return { ...DEFAULTS };
    } finally {
      settingsLoadInFlight = null;
    }
  })();

  return settingsLoadInFlight;
}

const STRATEGIST_MODEL_IDX_KEYS = new Set<keyof StrategistConfig>([
  "strategistSoloModelIdx",
  "strategistDebateAModelIdx",
  "strategistDebateBModelIdx",
]);

export async function updateSetting(key: string, value: number): Promise<void> {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);

  let coerced = value;
  if (key === "strategistArbitratorModelIdx") {
    coerced = isDebateWinnerArbitrator(value) ? ARBITRATOR_IDX_DEBATE_WINNER : normalizeStrategistModelIndex(value);
  } else if (STRATEGIST_MODEL_IDX_KEYS.has(key as keyof StrategistConfig)) {
    coerced = normalizeStrategistModelIndex(value);
  }

  await db
    .insert(strategistSettingsTable)
    .values({ key, value: coerced, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: strategistSettingsTable.key,
      set: { value: coerced, updatedAt: new Date() },
    });

  settingsCache = null;
}

export async function resetAllSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db
      .insert(strategistSettingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: strategistSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
  }
  settingsCache = null;
}

export function getDefaults(): StrategistConfig {
  return { ...DEFAULTS };
}

export interface SettingMetaEntry {
  key: string;
  label: string;
  group: string;
  default: number;
  min: number;
  max: number;
  step: number;
  description: string;
  /** Optional discrete options. When present, render as a dropdown. */
  options?: Array<{ value: number; label: string }>;
}

export function getSettingMeta(): SettingMetaEntry[] {
  const modelOptions = STRATEGIST_MODEL_OPTIONS.map((m, i) => ({ value: i, label: m.label }));
  return [
    { key: "strategistMode", label: "Strategist Mode", group: "Strategist", default: 1, min: 1, max: 3, step: 1, description: "Solo = one strategist runs the analysis. Debate = two strategists go back-and-forth across three rounds and converge on a single trade. Desk = three specialist analysts (Vol, Flow, Catalyst) report to a PM who makes the final call.", options: [
      { value: 1, label: "Solo (1 strategist)" },
      { value: 2, label: "Debate (2 strategists)" },
      { value: 3, label: "Desk (3 analysts + PM)" },
    ] },
    { key: "strategistSoloModelIdx", label: "Solo Model", group: "Strategist", default: 0, min: 0, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "Model used in Solo mode. In Desk mode this slot is used for the Vol Analyst.", options: modelOptions },
    { key: "strategistDebateAModelIdx", label: "Debate — Bull Model", group: "Strategist", default: 0, min: 0, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "Model used to argue the Bull side in Debate mode. In Desk mode this slot is used for the Flow Analyst.", options: modelOptions },
    { key: "strategistDebateBModelIdx", label: "Debate — Bear Model", group: "Strategist", default: 1, min: 0, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "Model used to argue the Bear side in Debate mode. In Desk mode this slot is used for the Catalyst Analyst.", options: modelOptions },
    { key: "strategistArbitratorModelIdx", label: "Debate — Arbitrator Model", group: "Strategist", default: 0, min: -1, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "Model used in Phase 3 to arbitrate between Bull's and Bear's structure proposals and ship the final trade. In Desk mode this slot is used for the PM.", options: [{ value: -1, label: "Debate Winner (winning side promoted to Senior PM)" }, ...modelOptions] },
    { key: "strategistConvergence", label: "Debate Convergence", group: "Strategist", default: 3, min: 1, max: 3, step: 1, description: "How the single final report is produced after the two strategists finish debating. Not used in Desk mode.", options: [
      { value: 1, label: "Higher confidence wins (fastest)" },
      { value: 2, label: "Synthesis pass (extra LLM merges both)" },
      { value: 3, label: "Hybrid — agree → synthesis, disagree → higher confidence" },
    ] },
    { key: "strategistTieBand", label: "Debate Tie Band (confidence pts)", group: "Strategist", default: 10, min: 1, max: 30, step: 1, description: "How close the Bull and Bear confidences must be (in points) for the verdict to land on SIDEWAYS / vol-neutral. Not used in Desk mode." },

    { key: "ioWeightR2", label: "Market Independence (R²)", group: "IOScore", default: 0.30, min: 0, max: 0.50, step: 0.05, description: "How much weight the 'is this stock independent from SPY' factor gets." },
    { key: "ioWeightResidual", label: "Abnormal Move (Residual Return)", group: "IOScore", default: 0.25, min: 0, max: 0.50, step: 0.05, description: "How much weight the 'is this stock making an unusual move' factor gets." },
    { key: "ioWeightCatalyst", label: "Catalyst (Benzinga)", group: "IOScore", default: 0.25, min: 0, max: 0.50, step: 0.05, description: "How much weight the 'does this stock have earnings/analyst news' factor gets." },
    { key: "ioWeightFlow", label: "Options Flow (Polygon)", group: "IOScore", default: 0.20, min: 0, max: 0.50, step: 0.05, description: "How much weight the 'are options traders doing something unusual' factor gets." },
    { key: "ioThresholdHigh", label: "High Idiosyncratic Threshold", group: "IOScore", default: 0.65, min: 0.40, max: 0.90, step: 0.05, description: "Above this score, the Strategist follows the stock's own direction regardless of macro regime." },
    { key: "ioThresholdMixed", label: "Mixed Floor Threshold", group: "IOScore", default: 0.40, min: 0.20, max: 0.60, step: 0.05, description: "Below this score, the stock is considered macro-aligned." },
    { key: "betaR2Lookback", label: "Beta/R² Lookback (days)", group: "IOScore", default: 30, min: 10, max: 60, step: 5, description: "How many trading days of history to calculate SPY correlation." },
    { key: "residualReturnLookback", label: "Residual Return Lookback (days)", group: "IOScore", default: 10, min: 3, max: 20, step: 1, description: "How many days of recent price action to compare against expected beta move." },
    { key: "scannerDefaultTrend", label: "Trend Weight", group: "Scanner Default", default: 25, min: 0, max: 40, step: 5, description: "Trend category weight in trending market mode." },
    { key: "scannerDefaultRS", label: "Relative Strength Weight", group: "Scanner Default", default: 20, min: 0, max: 40, step: 5, description: "Relative strength weight in trending market mode." },
    { key: "scannerDefaultVolume", label: "Volume Weight", group: "Scanner Default", default: 20, min: 0, max: 40, step: 5, description: "Volume category weight in trending market mode." },
    { key: "scannerDefaultIVR", label: "IVR Weight", group: "Scanner Default", default: 20, min: 0, max: 40, step: 5, description: "IV Rank weight in trending market mode." },
    { key: "scannerDefaultLiquidity", label: "Options Liquidity Weight", group: "Scanner Default", default: 15, min: 0, max: 40, step: 5, description: "Options liquidity weight in trending market mode." },
    { key: "scannerIdioTrend", label: "Trend Weight", group: "Scanner Idiosyncratic", default: 15, min: 0, max: 40, step: 5, description: "Trend weight when market is NEUTRAL/TRANSITION." },
    { key: "scannerIdioRS", label: "RS vs SPY Weight", group: "Scanner Idiosyncratic", default: 25, min: 0, max: 40, step: 5, description: "Relative strength vs SPY in idiosyncratic mode." },
    { key: "scannerIdioVolume", label: "Relative Volume Weight", group: "Scanner Idiosyncratic", default: 25, min: 0, max: 40, step: 5, description: "Volume ratio vs 20-day average in idiosyncratic mode." },
    { key: "scannerIdioIVR", label: "IVR Weight", group: "Scanner Idiosyncratic", default: 20, min: 0, max: 40, step: 5, description: "IV Rank weight in idiosyncratic mode." },
    { key: "scannerIdioLiquidity", label: "Options Liquidity Weight", group: "Scanner Idiosyncratic", default: 15, min: 0, max: 40, step: 5, description: "Options liquidity weight in idiosyncratic mode." },
    { key: "catalystBonusPoints", label: "Catalyst Bonus Points", group: "Scanner", default: 10, min: 0, max: 25, step: 1, description: "Flat score boost for confirmed catalyst in idiosyncratic mode." },
    { key: "scannerMinScore", label: "Minimum Score Threshold", group: "Scanner", default: 55, min: 30, max: 80, step: 5, description: "Minimum composite score to appear in scan results." },
    { key: "preferredDteMin", label: "Preferred DTE Min", group: "Strategy", default: 30, min: 0, max: 45, step: 1, description: "Minimum days to expiration for strategy selection. Set to 0 to allow 0DTE setups." },
    { key: "preferredDteMax", label: "Preferred DTE Max", group: "Strategy", default: 60, min: 30, max: 365, step: 5, description: "Maximum days to expiration for strategy selection. Raise to 180+ for longer-dated structures, or up to 365 for LEAPS." },
    { key: "spreadWidthUnlimited", label: "Spread Width — Unlimited", group: "Strategy", default: 1, min: 0, max: 1, step: 1, description: "When ON, the strategist agents are free to pick any spread width that fits their thesis (the slider below is ignored). When OFF, the slider's value is treated as a hard cap and the agents must respect it." },
    { key: "spreadWidth", label: "Spread Width ($)", group: "Strategy", default: 5, min: 1, max: 100, step: 0.50, description: "Width of vertical spreads in dollars. Only enforced when 'Spread Width — Unlimited' above is OFF." },
    { key: "minOpenInterest", label: "Min Open Interest Per Leg", group: "Strategy", default: 50, min: 10, max: 500, step: 10, description: "Minimum OI required for each leg." },
    { key: "maxBidAskSpreadPct", label: "Max Bid-Ask Spread (%)", group: "Strategy", default: 25, min: 5, max: 50, step: 5, description: "Maximum bid-ask spread as percent of mid price." },
    { key: "earningsSuppressDays", label: "Scanner Earnings Suppress Window (days)", group: "Earnings", default: 14, min: 0, max: 45, step: 1, description: "Scanner suppresses tickers with earnings within this many days. Set to 0 to disable. Source: Benzinga (confirmed) → Yahoo fallback." },
    { key: "earningsInsideExpiryBehavior", label: "Earnings Inside Expiry Behavior", group: "Earnings", default: 2, min: 1, max: 3, step: 1, description: "What to do when the AI proposes a structure whose expiration is after the next earnings release. BLOCK = no trade. WARN = ship trade with banner. IGNORE = silent.", options: [
      { value: 1, label: "BLOCK — no trade" },
      { value: 2, label: "WARN — show banner, allow trade" },
      { value: 3, label: "IGNORE — silent" },
    ] },
    { key: "noEdgeGateBehavior", label: "No-Catalyst-In-Window Behavior", group: "Strategy", default: 2, min: 1, max: 3, step: 1, description: "What to do when there is no scheduled catalyst between today and the proposed expiration AND no recently-fired residual catalyst AND macro regime is NEUTRAL/TRANSITION. Most swing setups (post-earnings drift, mean reversion, vol regime, trend continuation) have no scheduled catalyst by definition, so WARN is the swing-trader-correct default.", options: [
      { value: 1, label: "BLOCK — refuse trade (legacy day-trader behavior)" },
      { value: 2, label: "WARN — ship trade with banner" },
      { value: 3, label: "IGNORE — silent" },
    ] },
    { key: "correlationLowCeiling", label: "Correlation LOW Ceiling", group: "Correlation", default: 0.40, min: 0.20, max: 0.50, step: 0.05, description: "Below this average correlation = LOW regime." },
    { key: "correlationHighFloor", label: "Correlation HIGH Floor", group: "Correlation", default: 0.75, min: 0.60, max: 0.90, step: 0.05, description: "Above this average correlation = HIGH regime." },
    { key: "toxicGateEnabled", label: "Toxic Gate Enabled", group: "Toxic Gate", default: 1, min: 0, max: 1, step: 1, description: "Master switch for the toxic day gate." },
    { key: "toxicPathAEnabled", label: "Path A: EXTREME + HIGH Correlation", group: "Toxic Gate", default: 1, min: 0, max: 1, step: 1, description: "Require EXTREME risk and HIGH correlation to block." },
    { key: "toxicPathBEnabled", label: "Path B: Major Event + ELEVATED Risk", group: "Toxic Gate", default: 1, min: 0, max: 1, step: 1, description: "Block when FOMC/CPI within 24h and risk is ELEVATED+." },
    { key: "regimeUpdateFrequencyMin", label: "Regime Update Frequency (min)", group: "Regime", default: 5, min: 1, max: 30, step: 1, description: "How often to refresh the regime post-processor." },
  ];
}
