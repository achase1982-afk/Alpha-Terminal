import { db, strategistSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
  minOpenInterest: number;
  maxBidAskSpreadPct: number;
  earningsSuppressDays: number;
  earningsInsideExpiryBehavior: number;
  correlationLowCeiling: number;
  correlationHighFloor: number;
  toxicGateEnabled: number;
  toxicPathAEnabled: number;
  toxicPathBEnabled: number;
  regimeUpdateFrequencyMin: number;
  // Strategist mode + model selection
  strategistMode: number; // 1 = Solo, 2 = Debate
  strategistConvergence: number; // 1 = highest_confidence, 2 = synthesis, 3 = hybrid
  strategistSoloModelIdx: number;
  strategistDebateAModelIdx: number;
  strategistDebateBModelIdx: number;
  strategistArbitratorModelIdx: number;
}

// Model catalog used by the strategist. Stored as an integer index in the
// settings table (which is number-only) to avoid a schema migration.
// IMPORTANT: only append to this list — do not reorder, or saved settings
// will silently point at the wrong model.
export interface StrategistModelOption {
  provider: "anthropic" | "google";
  model: string;
  label: string;
}

export const STRATEGIST_MODEL_OPTIONS: StrategistModelOption[] = [
  { provider: "anthropic", model: "claude-opus-4-7", label: "Claude Opus 4.7 (Anthropic)" },
  { provider: "google", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Google)" },
  { provider: "anthropic", model: "claude-opus-4-6", label: "Claude Opus 4.6 (Anthropic)" },
  { provider: "google", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Google)" },
  { provider: "anthropic", model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Anthropic)" },
  { provider: "google", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Google)" },
];

export function getStrategistModel(idx: number): StrategistModelOption {
  if (!Number.isFinite(idx) || idx < 0 || idx >= STRATEGIST_MODEL_OPTIONS.length) {
    return STRATEGIST_MODEL_OPTIONS[0];
  }
  return STRATEGIST_MODEL_OPTIONS[Math.floor(idx)];
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

const DEFAULTS: Record<string, number> = {
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
  minOpenInterest: 50,
  maxBidAskSpreadPct: 25,
  earningsSuppressDays: 14,
  earningsInsideExpiryBehavior: 2,
  correlationLowCeiling: 0.40,
  correlationHighFloor: 0.75,
  toxicGateEnabled: 1,
  toxicPathAEnabled: 1,
  toxicPathBEnabled: 1,
  regimeUpdateFrequencyMin: 5,
  strategistMode: 1,
  strategistConvergence: 3,
  strategistSoloModelIdx: 0,
  strategistDebateAModelIdx: 0,
  strategistDebateBModelIdx: 1,
  strategistArbitratorModelIdx: 0,
};

let settingsCache: Record<string, number> | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 60_000;

export async function getSettings(): Promise<StrategistConfig> {
  if (settingsCache && Date.now() - cacheTs < CACHE_TTL_MS) {
    return settingsCache as unknown as StrategistConfig;
  }

  try {
    const rows = await db.select().from(strategistSettingsTable);
    const merged = { ...DEFAULTS };
    for (const row of rows) {
      merged[row.key] = row.value;
    }
    settingsCache = merged;
    cacheTs = Date.now();
    return merged as unknown as StrategistConfig;
  } catch (err) {
    logger.error({ err }, "Failed to load strategist settings, using defaults");
    return DEFAULTS as unknown as StrategistConfig;
  }
}

export async function updateSetting(key: string, value: number): Promise<void> {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);

  await db
    .insert(strategistSettingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: strategistSettingsTable.key,
      set: { value, updatedAt: new Date() },
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

export function getDefaults(): Record<string, number> {
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
    { key: "strategistMode", label: "Strategist Mode", group: "AI Strategist", default: 1, min: 1, max: 2, step: 1, description: "Solo = one strategist runs the analysis. Debate = two strategists go back-and-forth across three rounds and converge on a single trade.", options: [
      { value: 1, label: "Solo (1 strategist)" },
      { value: 2, label: "Debate (2 strategists)" },
    ] },
    { key: "strategistSoloModelIdx", label: "Solo Strategist Model", group: "AI Strategist", default: 0, min: 0, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "AI model used in Solo mode.", options: modelOptions },
    { key: "strategistDebateAModelIdx", label: "Debate — Strategist A Model", group: "AI Strategist", default: 0, min: 0, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "Model for Strategist A in Debate mode. Can match B (twin debate) or differ (cross-provider debate).", options: modelOptions },
    { key: "strategistDebateBModelIdx", label: "Debate — Strategist B Model", group: "AI Strategist", default: 1, min: 0, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "Model for Strategist B in Debate mode.", options: modelOptions },
    { key: "strategistArbitratorModelIdx", label: "Debate — Arbitrator (Senior PM) Model", group: "AI Strategist", default: 0, min: -1, max: STRATEGIST_MODEL_OPTIONS.length - 1, step: 1, description: "Model used in Phase 3 to arbitrate between A's and B's structure proposals and ship the final trade. Can be A, B, an independent third model, or 'Debate Winner' (whichever side wins the directional verdict is promoted to Senior PM).", options: [{ value: -1, label: "Debate Winner (winning side promoted to Senior PM)" }, ...modelOptions] },
    { key: "strategistConvergence", label: "Debate Convergence", group: "AI Strategist", default: 3, min: 1, max: 3, step: 1, description: "How the single final report is produced after the two strategists finish debating.", options: [
      { value: 1, label: "Higher confidence wins (fastest)" },
      { value: 2, label: "Synthesis pass (extra LLM merges both)" },
      { value: 3, label: "Hybrid — agree → synthesis, disagree → higher confidence" },
    ] },

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
    { key: "preferredDteMin", label: "Preferred DTE Min", group: "Strategy", default: 30, min: 7, max: 45, step: 1, description: "Minimum days to expiration for strategy selection." },
    { key: "preferredDteMax", label: "Preferred DTE Max", group: "Strategy", default: 60, min: 30, max: 90, step: 5, description: "Maximum days to expiration for strategy selection." },
    { key: "spreadWidth", label: "Spread Width ($)", group: "Strategy", default: 5, min: 1, max: 10, step: 0.50, description: "Width of vertical spreads in dollars." },
    { key: "minOpenInterest", label: "Min Open Interest Per Leg", group: "Strategy", default: 50, min: 10, max: 500, step: 10, description: "Minimum OI required for each leg." },
    { key: "maxBidAskSpreadPct", label: "Max Bid-Ask Spread (%)", group: "Strategy", default: 25, min: 5, max: 50, step: 5, description: "Maximum bid-ask spread as percent of mid price." },
    { key: "earningsSuppressDays", label: "Scanner Earnings Suppress Window (days)", group: "Earnings", default: 14, min: 0, max: 45, step: 1, description: "Scanner suppresses tickers with earnings within this many days. Set to 0 to disable. Source: Benzinga (confirmed) → Yahoo fallback." },
    { key: "earningsInsideExpiryBehavior", label: "Earnings Inside Expiry Behavior", group: "Earnings", default: 2, min: 1, max: 3, step: 1, description: "What to do when the AI proposes a structure whose expiration is after the next earnings release. BLOCK = no trade. WARN = ship trade with banner. IGNORE = silent.", options: [
      { value: 1, label: "BLOCK — no trade" },
      { value: 2, label: "WARN — show banner, allow trade" },
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
