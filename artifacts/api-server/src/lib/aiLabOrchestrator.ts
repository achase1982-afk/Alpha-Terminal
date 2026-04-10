import { db, aiLabIdeasTable, aiLabWatchlistTable, aiLabEmbeddingsTable, aiLabDeliberationsTable } from "@workspace/db";
import { eq, inArray, desc, sql } from "drizzle-orm";
import { emitTelemetry, createTelemetryBatch } from "./telemetryStore.js";
import {
  getUniverseAnomalies,
  getTickerSnapshot,
  getRegimeState,
  getScannerAlignment,
  AI_LAB_CONFIG,
  type TickerSnapshot,
  type RegimeState,
} from "./aiLabService.js";
import {
  validateAiLabIdea,
  type TradeIdeaCandidate,
  type MarketDataSnapshot,
} from "./aiLabValidator.js";
import { logger } from "./logger.js";
import { createAnalystClient } from "./aiLabAnalystClient.js";
import { createSkepticClient } from "./aiLabSkepticClient.js";
import { buildCandidateIdeaFromLlms, buildFinalDecision } from "./aiLabLlmMerger.js";
import { getAiLabStrategistConfig } from "./aiLabConfig.js";
import type {
  AiLabAnalystClient,
  AiLabSkepticClient,
  AnalystRequest,
  SkepticRequest,
  AnalystResponse,
  SkepticResponse,
} from "./aiLabLlmTypes.js";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

export const ORCHESTRATOR_CONFIG = {
  OVERNIGHT_TOP_N: 50,
  PREMARKET_TOP_N: 10,
  TRIGGER_MIN_AVG_VOLUME: 500_000,
  TRIGGER_MAX_DATA_FRESHNESS_MIN: 30,
  PRICE_SHOCK_MIN_MOVE_PCT: 3.0,
  BLOCK_FLOW_MIN_NOTIONAL: 500_000,
  SCANNER_SCORE_MIN_DELTA: 15,
  ET_OFFSET_HOURS: -5,
};

type PassName =
  | "OVERNIGHT_DIGEST"
  | "PREMARKET_PLAN"
  | "POST_OPEN_CHECK"
  | "MID_MORNING_SCAN"
  | "MIDDAY_ROTATION"
  | "POWER_HOUR_PREP"
  | "POST_MARKET_REFLECTION";

interface ScheduledJob {
  passName: PassName;
  etHour: number;
  etMinute: number;
  handler: () => Promise<void>;
  timerId?: ReturnType<typeof setTimeout>;
  intervalId?: ReturnType<typeof setInterval>;
}

interface PipelineResult {
  symbol: string;
  approved: boolean;
  rejectionReason?: string;
  ideaId?: number;
}

// ─── CONCURRENCY GUARD ──────────────────────────────────────────────────────

const runningPasses = new Set<string>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (runningPasses.has(key)) {
    logger.warn({ key }, "AI Lab: skipping — already running");
    return null;
  }
  runningPasses.add(key);
  try {
    return await fn();
  } finally {
    runningPasses.delete(key);
  }
}

let orchestratorInitialized = false;

// ─── TELEMETRY HELPER ────────────────────────────────────────────────────────

function logAiLabEvent(
  type: string,
  payload: Record<string, unknown>,
  batch: string,
  severity: "INFO" | "WARN" | "ERROR" = "INFO",
): void {
  const message = `AI Lab Orchestrator: [${type}] ${payload.passName ?? payload.triggerType ?? payload.symbol ?? ""}`;
  emitTelemetry("STRATEGIST", severity, message, { type, ...payload }, "AI_LAB", batch);
}

// ─── LLM CLIENT FACTORY (reads from config each run) ────────────────────────

function buildClients(): { analyst: AiLabAnalystClient; skeptic: AiLabSkepticClient } {
  const cfg = getAiLabStrategistConfig();
  return {
    analyst: createAnalystClient(cfg.analystModelProvider, cfg.analystModelName, cfg.analystTemperature),
    skeptic: createSkepticClient(cfg.skepticModelProvider, cfg.skepticModelName, cfg.skepticTemperature),
  };
}

// ─── CORE PIPELINE ──────────────────────────────────────────────────────────

function computeDataFreshnessMinutes(): number {
  const now = new Date();
  const etHour = (now.getUTCHours() + ORCHESTRATOR_CONFIG.ET_OFFSET_HOURS + 24) % 24;
  if (etHour >= 9 && etHour < 16) return 0;
  if (etHour >= 16 && etHour < 20) return (etHour - 16) * 60;
  return ORCHESTRATOR_CONFIG.TRIGGER_MAX_DATA_FRESHNESS_MIN + 1;
}

async function runPipeline(
  symbol: string,
  snapshot: TickerSnapshot,
  regime: RegimeState,
  batch: string,
  source: string,
): Promise<PipelineResult> {
  const cfg = getAiLabStrategistConfig();

  if (!cfg.enabled) {
    logAiLabEvent("AI_LAB_DISABLED", { symbol, passName: source }, batch);
    return { symbol, approved: false, rejectionReason: "AI_LAB_DISABLED" };
  }

  const { analyst: analystClient, skeptic: skepticClient } = buildClients();

  const activeIdeas = await db
    .select()
    .from(aiLabIdeasTable)
    .where(inArray(aiLabIdeasTable.status, ["NEW", "ACTIVE"]));

  const runContext = { passName: source, timestamp: new Date().toISOString() };

  const analystRequest: AnalystRequest = {
    symbol,
    runContext,
    tickerSnapshot: snapshot as unknown as Record<string, unknown>,
    regimeState: regime as unknown as Record<string, unknown>,
    patternPerformance: null,
    activeIdeasSummary: {
      activeCount: activeIdeas.length,
      symbols: activeIdeas.map((i) => i.symbol),
      sectors: activeIdeas.map((i) => i.sector).filter(Boolean) as string[],
    },
    baselinesSummary: null,
  };

  logAiLabEvent("ANALYST_REQUEST", {
    symbol,
    passName: source,
    provider: cfg.analystModelProvider,
    model: cfg.analystModelName,
    temperature: cfg.analystTemperature,
  }, batch);

  let analystResponse: AnalystResponse;
  try {
    analystResponse = await analystClient.generateIdea(analystRequest);
  } catch (err: any) {
    logAiLabEvent("ANALYST_PARSE_ERROR", {
      symbol,
      passName: source,
      errorMessage: err.message,
      rawSnippet: String(err.message).slice(0, 200),
    }, batch, "ERROR");
    return { symbol, approved: false, rejectionReason: "ANALYST_LLM_FAILURE" };
  }

  logAiLabEvent("ANALYST_RESPONSE", {
    symbol,
    signalStrength: analystResponse.confidence.signalStrength,
    convictionLevel: analystResponse.confidence.convictionLevel,
    mainSignals: analystResponse.rationale.mainSignals,
    direction: analystResponse.tradeIdeaCore.direction,
  }, batch);

  const skepticRequest: SkepticRequest = {
    symbol,
    runContext,
    tickerSnapshot: snapshot as unknown as Record<string, unknown>,
    regimeState: regime as unknown as Record<string, unknown>,
    candidateIdea: analystResponse,
  };

  let skepticResponse: SkepticResponse | null = null;
  try {
    skepticResponse = await skepticClient.critiqueIdea(skepticRequest);
    logAiLabEvent("SKEPTIC_RESPONSE", {
      symbol,
      critiqueScore: skepticResponse.critiqueScore,
      flags: skepticResponse.flags,
    }, batch);
  } catch (err: any) {
    logAiLabEvent("SKEPTIC_PARSE_ERROR", {
      symbol,
      passName: source,
      errorMessage: err.message,
      rawSnippet: String(err.message).slice(0, 200),
    }, batch, "WARN");
  }

  const merged = buildCandidateIdeaFromLlms(
    symbol,
    analystResponse,
    skepticResponse,
    regime,
    analystClient.modelName,
    skepticClient.modelName,
  );

  const marketData: MarketDataSnapshot = {
    avgVolume20d: snapshot.volumeSummary.median20d,
    dataFreshnessMinutes: computeDataFreshnessMinutes(),
  };

  const validation = await validateAiLabIdea(merged.candidate, activeIdeas, marketData);

  const finalDecision = buildFinalDecision(
    merged,
    validation.approved,
    validation.rejectionReason,
  );

  const inputSnapshot = {
    price: (snapshot as any).price ?? null,
    scannerAlignment: snapshot.scannerAlignment ?? null,
    volumeSummary: snapshot.volumeSummary,
    regime: `${regime.trendState}|${regime.volState}|${regime.breadthState}`,
  };

  let ideaId: number | undefined;

  if (!validation.approved) {
    logAiLabEvent("IDEA_REJECTED", {
      symbol,
      rejectionReason: validation.rejectionReason,
      signalStrength: merged.signalStrength,
      source,
      finalDecision: finalDecision.decision,
    }, batch, "WARN");

    try {
      await db.insert(aiLabDeliberationsTable).values({
        symbol,
        source,
        analystModelName: merged.analystModelName,
        criticModelName: merged.criticModelName,
        inputSnapshot,
        primaryProposal: merged.primaryProposal,
        skepticCritique: merged.skepticCritique,
        finalDecision,
        ideaId: null,
      });
    } catch (delErr: any) {
      logger.warn({ err: delErr, symbol }, "AI Lab: failed to write deliberation (rejected)");
    }

    return { symbol, approved: false, rejectionReason: validation.rejectionReason };
  }

  const [inserted] = await db
    .insert(aiLabIdeasTable)
    .values({
      symbol: merged.candidate.symbol,
      direction: merged.candidate.direction,
      instrumentType: merged.candidate.instrumentType,
      optionStructureType: merged.optionStructureType,
      legs: merged.legs,
      entryZone: merged.entryZone,
      softStop: merged.softStop,
      targetZone: merged.targetZone,
      timeHorizon: merged.timeHorizon,
      thesis: merged.thesis,
      catalyst: merged.catalyst,
      invalidation: merged.invalidation,
      regimeFit: merged.regimeFit,
      mainSignals: merged.mainSignals,
      signalStrength: merged.signalStrength,
      convictionLevel: merged.convictionLevel,
      uncertainty: merged.uncertainty,
      entrySpreadPct: merged.candidate.entrySpreadPct,
      oiAtEntry: merged.candidate.oiAtEntry,
      volumeAtEntry: merged.candidate.volumeAtEntry,
      volumeToOiRatio: merged.candidate.volumeToOiRatio,
      regimeAtCreation: merged.regimeAtCreation,
      scannerAlignmentAtCreation: merged.scannerAlignmentAtCreation,
      analystModelName: merged.analystModelName,
      criticModelName: merged.criticModelName,
      analystNote: merged.analystNote,
      criticNote: merged.criticNote,
      primaryProposal: merged.primaryProposal,
      skepticCritique: merged.skepticCritique,
      finalDecision,
      status: "ACTIVE",
    })
    .returning();

  ideaId = inserted.id;

  logAiLabEvent("IDEA_APPROVED", {
    symbol,
    ideaId: inserted.id,
    signalStrength: merged.signalStrength,
    direction: merged.candidate.direction,
    analystModelName: merged.analystModelName,
    criticModelName: merged.criticModelName,
    finalDecision: finalDecision.decision,
    source,
  }, batch);

  try {
    await db.insert(aiLabDeliberationsTable).values({
      symbol,
      source,
      analystModelName: merged.analystModelName,
      criticModelName: merged.criticModelName,
      inputSnapshot,
      primaryProposal: merged.primaryProposal,
      skepticCritique: merged.skepticCritique,
      finalDecision,
      ideaId: inserted.id,
    });
  } catch (delErr: any) {
    logger.warn({ err: delErr, symbol, ideaId: inserted.id }, "AI Lab: failed to write deliberation (approved)");
  }

  const embeddingText = [
    symbol,
    merged.candidate.direction,
    merged.catalyst,
    merged.regimeAtCreation,
    `THESIS: ${merged.thesis}`,
    `ANALYST: ${merged.analystNote}`,
    `CRITIC: ${merged.criticNote}`,
  ].join(" | ");

  try {
    await db.insert(aiLabEmbeddingsTable).values({
      ideaId: inserted.id,
      embedding: null,
      tags: {
        text: embeddingText,
        symbol,
        direction: merged.candidate.direction,
        catalyst: merged.catalyst,
        regimeAtCreation: merged.regimeAtCreation,
        signalStrength: merged.signalStrength,
      },
    });
  } catch (embErr: any) {
    logger.warn({ err: embErr, ideaId: inserted.id }, "AI Lab: failed to write embedding stub");
  }

  return { symbol, approved: true, ideaId };
}

// ─── SCHEDULED PASSES ────────────────────────────────────────────────────────

async function overnightDigest(): Promise<void> {
  await withLock("OVERNIGHT_DIGEST", async () => {
    const batch = createTelemetryBatch("AI_LAB");
    const passName = "OVERNIGHT_DIGEST";
    logAiLabEvent("SCHEDULE_RUN", { passName, phase: "START" }, batch);

    try {
      const anomalies = await getUniverseAnomalies({}, ORCHESTRATOR_CONFIG.OVERNIGHT_TOP_N);

      await db.delete(aiLabWatchlistTable).where(eq(aiLabWatchlistTable.passName, passName));

      if (anomalies.length > 0) {
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + 18);

        for (const a of anomalies) {
          const compositeScore = Object.values(a.anomalyScores).reduce((s, v) => s + v, 0);
          await db
            .insert(aiLabWatchlistTable)
            .values({
              symbol: a.symbol,
              anomalyTypes: a.anomalyTypes,
              anomalyScores: a.anomalyScores,
              compositeScore,
              passName,
              expiresAt: expiry,
            })
            .onConflictDoUpdate({
              target: [aiLabWatchlistTable.symbol, aiLabWatchlistTable.passName],
              set: {
                anomalyTypes: sql`excluded.anomaly_types`,
                anomalyScores: sql`excluded.anomaly_scores`,
                compositeScore: sql`excluded.composite_score`,
                expiresAt: sql`excluded.expires_at`,
                createdAt: sql`now()`,
              },
            });
        }
      }

      logAiLabEvent("SCHEDULE_RUN", {
        passName,
        phase: "COMPLETE",
        anomaliesFound: anomalies.length,
        topSymbols: anomalies.slice(0, 5).map((a) => a.symbol).join(","),
      }, batch);
    } catch (err: any) {
      logAiLabEvent("SCHEDULE_RUN", { passName, phase: "ERROR", error: err.message }, batch, "ERROR");
    }
  });
}

async function preMarketPlan(): Promise<void> {
  await withLock("PREMARKET_PLAN", async () => {
    const batch = createTelemetryBatch("AI_LAB");
    const passName = "PREMARKET_PLAN";
    logAiLabEvent("SCHEDULE_RUN", { passName, phase: "START" }, batch);

    try {
      const watchlist = await db
        .select()
        .from(aiLabWatchlistTable)
        .where(eq(aiLabWatchlistTable.passName, "OVERNIGHT_DIGEST"))
        .orderBy(desc(aiLabWatchlistTable.compositeScore))
        .limit(ORCHESTRATOR_CONFIG.PREMARKET_TOP_N);

      if (watchlist.length === 0) {
        logAiLabEvent("SCHEDULE_RUN", { passName, phase: "COMPLETE", note: "No overnight watchlist entries" }, batch, "WARN");
        return;
      }

      const regime = await getRegimeState();
      const results: PipelineResult[] = [];

      for (const entry of watchlist) {
        const snapshot = await getTickerSnapshot(entry.symbol);
        if (!snapshot) {
          logAiLabEvent("IDEA_VALIDATION", {
            symbol: entry.symbol,
            approved: false,
            rejectionReason: "NO_SNAPSHOT_DATA",
            source: passName,
          }, batch, "WARN");
          results.push({ symbol: entry.symbol, approved: false, rejectionReason: "NO_SNAPSHOT_DATA" });
          continue;
        }

        const result = await runPipeline(entry.symbol, snapshot, regime, batch, passName);
        results.push(result);
      }

      const approved = results.filter((r) => r.approved).length;
      const rejected = results.filter((r) => !r.approved).length;

      logAiLabEvent("SCHEDULE_RUN", {
        passName,
        phase: "COMPLETE",
        candidatesGenerated: results.length,
        ideasApproved: approved,
        ideasRejected: rejected,
      }, batch);
    } catch (err: any) {
      logAiLabEvent("SCHEDULE_RUN", { passName, phase: "ERROR", error: err.message }, batch, "ERROR");
    }
  });
}

async function postOpenCheck(): Promise<void> {
  const batch = createTelemetryBatch("AI_LAB");
  const passName = "POST_OPEN_CHECK";
  logAiLabEvent("SCHEDULE_RUN", { passName, phase: "START" }, batch);

  try {
    const activeIdeas = await db
      .select()
      .from(aiLabIdeasTable)
      .where(inArray(aiLabIdeasTable.status, ["ACTIVE", "NEW"]));

    logAiLabEvent("SCHEDULE_RUN", {
      passName,
      phase: "COMPLETE",
      activeIdeaCount: activeIdeas.length,
      symbols: activeIdeas.map((i) => i.symbol).join(","),
    }, batch);
  } catch (err: any) {
    logAiLabEvent("SCHEDULE_RUN", { passName, phase: "ERROR", error: err.message }, batch, "ERROR");
  }
}

async function midMorningScan(): Promise<void> {
  const batch = createTelemetryBatch("AI_LAB");
  logAiLabEvent("SCHEDULE_RUN", { passName: "MID_MORNING_SCAN", phase: "START" }, batch);

  try {
    const activeIdeas = await db
      .select()
      .from(aiLabIdeasTable)
      .where(eq(aiLabIdeasTable.status, "ACTIVE"));

    logAiLabEvent("SCHEDULE_RUN", {
      passName: "MID_MORNING_SCAN",
      phase: "COMPLETE",
      activeIdeaCount: activeIdeas.length,
      note: "Stub — will add intraday monitoring in LLM phase",
    }, batch);
  } catch (err: any) {
    logAiLabEvent("SCHEDULE_RUN", { passName: "MID_MORNING_SCAN", phase: "ERROR", error: err.message }, batch, "ERROR");
  }
}

async function middayRotationCheck(): Promise<void> {
  const batch = createTelemetryBatch("AI_LAB");
  logAiLabEvent("SCHEDULE_RUN", { passName: "MIDDAY_ROTATION", phase: "START" }, batch);

  try {
    const activeIdeas = await db
      .select()
      .from(aiLabIdeasTable)
      .where(eq(aiLabIdeasTable.status, "ACTIVE"));

    logAiLabEvent("SCHEDULE_RUN", {
      passName: "MIDDAY_ROTATION",
      phase: "COMPLETE",
      activeIdeaCount: activeIdeas.length,
      note: "Stub — will check rotation signals in LLM phase",
    }, batch);
  } catch (err: any) {
    logAiLabEvent("SCHEDULE_RUN", { passName: "MIDDAY_ROTATION", phase: "ERROR", error: err.message }, batch, "ERROR");
  }
}

async function powerHourPrep(): Promise<void> {
  const batch = createTelemetryBatch("AI_LAB");
  logAiLabEvent("SCHEDULE_RUN", { passName: "POWER_HOUR_PREP", phase: "START" }, batch);

  try {
    const activeIdeas = await db
      .select()
      .from(aiLabIdeasTable)
      .where(eq(aiLabIdeasTable.status, "ACTIVE"));

    logAiLabEvent("SCHEDULE_RUN", {
      passName: "POWER_HOUR_PREP",
      phase: "COMPLETE",
      activeIdeaCount: activeIdeas.length,
      note: "Stub — will add EOD positioning logic in LLM phase",
    }, batch);
  } catch (err: any) {
    logAiLabEvent("SCHEDULE_RUN", { passName: "POWER_HOUR_PREP", phase: "ERROR", error: err.message }, batch, "ERROR");
  }
}

async function postMarketReflection(): Promise<void> {
  const batch = createTelemetryBatch("AI_LAB");
  logAiLabEvent("SCHEDULE_RUN", { passName: "POST_MARKET_REFLECTION", phase: "START" }, batch);

  try {
    const activeIdeas = await db
      .select()
      .from(aiLabIdeasTable)
      .where(inArray(aiLabIdeasTable.status, ["ACTIVE", "NEW"]));

    logAiLabEvent("SCHEDULE_RUN", {
      passName: "POST_MARKET_REFLECTION",
      phase: "COMPLETE",
      activeIdeaCount: activeIdeas.length,
      note: "Stub — will add EOD P&L evaluation and idea expiration in LLM phase",
    }, batch);
  } catch (err: any) {
    logAiLabEvent("SCHEDULE_RUN", { passName: "POST_MARKET_REFLECTION", phase: "ERROR", error: err.message }, batch, "ERROR");
  }
}

// ─── EVENT-DRIVEN TRIGGERS ──────────────────────────────────────────────────

export async function priceShockTrigger(
  symbol: string,
  movePct: number,
  windowMinutes: number,
  volumeSpikeRatio: number,
): Promise<PipelineResult | null> {
  const batch = createTelemetryBatch("AI_LAB");
  const triggerType = "PRICE_SHOCK_TRIGGER";

  logAiLabEvent("TRIGGER_FIRED", {
    triggerType: "PRICE_SHOCK",
    symbol,
    movePct,
    windowMinutes,
    volumeSpikeRatio,
  }, batch);

  if (Math.abs(movePct) < ORCHESTRATOR_CONFIG.PRICE_SHOCK_MIN_MOVE_PCT) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "PRICE_SHOCK",
      symbol,
      reason: "MOVE_BELOW_THRESHOLD",
      movePct,
      threshold: ORCHESTRATOR_CONFIG.PRICE_SHOCK_MIN_MOVE_PCT,
    }, batch);
    return null;
  }

  const snapshot = await getTickerSnapshot(symbol);
  if (!snapshot) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "PRICE_SHOCK",
      symbol,
      reason: "NO_DATA",
    }, batch, "WARN");
    return null;
  }

  if (snapshot.volumeSummary.median20d < ORCHESTRATOR_CONFIG.TRIGGER_MIN_AVG_VOLUME) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "PRICE_SHOCK",
      symbol,
      reason: "ILLIQUID",
      avgVolume20d: snapshot.volumeSummary.median20d,
    }, batch);
    return null;
  }

  const regime = await getRegimeState();
  return runPipeline(symbol, snapshot, regime, batch, triggerType);
}

export async function blockFlowTrigger(
  symbol: string,
  blockNotional: number,
  blockPctOfADV: number,
): Promise<PipelineResult | null> {
  const batch = createTelemetryBatch("AI_LAB");
  const triggerType = "BLOCK_FLOW_TRIGGER";

  logAiLabEvent("TRIGGER_FIRED", {
    triggerType: "BLOCK_FLOW",
    symbol,
    blockNotional,
    blockPctOfADV,
  }, batch);

  if (blockNotional < ORCHESTRATOR_CONFIG.BLOCK_FLOW_MIN_NOTIONAL) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "BLOCK_FLOW",
      symbol,
      reason: "NOTIONAL_BELOW_THRESHOLD",
      blockNotional,
      threshold: ORCHESTRATOR_CONFIG.BLOCK_FLOW_MIN_NOTIONAL,
    }, batch);
    return null;
  }

  const snapshot = await getTickerSnapshot(symbol);
  if (!snapshot) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "BLOCK_FLOW",
      symbol,
      reason: "NO_DATA",
    }, batch, "WARN");
    return null;
  }

  if (snapshot.volumeSummary.median20d < ORCHESTRATOR_CONFIG.TRIGGER_MIN_AVG_VOLUME) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "BLOCK_FLOW",
      symbol,
      reason: "ILLIQUID",
      avgVolume20d: snapshot.volumeSummary.median20d,
    }, batch);
    return null;
  }

  const regime = await getRegimeState();
  return runPipeline(symbol, snapshot, regime, batch, triggerType);
}

export async function scannerScoreJumpTrigger(
  symbol: string,
  deltaDiscovery: number,
  deltaMomentum: number,
): Promise<PipelineResult | null> {
  const batch = createTelemetryBatch("AI_LAB");
  const triggerType = "SCANNER_SCORE_TRIGGER";

  logAiLabEvent("TRIGGER_FIRED", {
    triggerType: "SCANNER_SCORE",
    symbol,
    deltaDiscovery,
    deltaMomentum,
  }, batch);

  const threshold = ORCHESTRATOR_CONFIG.SCANNER_SCORE_MIN_DELTA;
  if (Math.abs(deltaDiscovery) < threshold && Math.abs(deltaMomentum) < threshold) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "SCANNER_SCORE",
      symbol,
      reason: "DELTA_BELOW_THRESHOLD",
      deltaDiscovery,
      deltaMomentum,
      threshold,
    }, batch);
    return null;
  }

  const snapshot = await getTickerSnapshot(symbol);
  if (!snapshot) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "SCANNER_SCORE",
      symbol,
      reason: "NO_DATA",
    }, batch, "WARN");
    return null;
  }

  if (snapshot.volumeSummary.median20d < ORCHESTRATOR_CONFIG.TRIGGER_MIN_AVG_VOLUME) {
    logAiLabEvent("TRIGGER_FILTERED", {
      triggerType: "SCANNER_SCORE",
      symbol,
      reason: "ILLIQUID",
      avgVolume20d: snapshot.volumeSummary.median20d,
    }, batch);
    return null;
  }

  const regime = await getRegimeState();
  return runPipeline(symbol, snapshot, regime, batch, triggerType);
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────

const SCHEDULE: ScheduledJob[] = [
  { passName: "OVERNIGHT_DIGEST",      etHour: 3,  etMinute: 30, handler: overnightDigest },
  { passName: "PREMARKET_PLAN",        etHour: 8,  etMinute: 0,  handler: preMarketPlan },
  { passName: "POST_OPEN_CHECK",       etHour: 9,  etMinute: 45, handler: postOpenCheck },
  { passName: "MID_MORNING_SCAN",      etHour: 10, etMinute: 30, handler: midMorningScan },
  { passName: "MIDDAY_ROTATION",       etHour: 12, etMinute: 0,  handler: middayRotationCheck },
  { passName: "POWER_HOUR_PREP",       etHour: 15, etMinute: 0,  handler: powerHourPrep },
  { passName: "POST_MARKET_REFLECTION", etHour: 16, etMinute: 15, handler: postMarketReflection },
];

function getNextRunMs(etHour: number, etMinute: number): number {
  const now = new Date();
  const target = new Date(now);
  const utcHour = etHour - ORCHESTRATOR_CONFIG.ET_OFFSET_HOURS;
  target.setUTCHours(utcHour, etMinute, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

function scheduleJob(job: ScheduledJob): void {
  if (job.timerId) clearTimeout(job.timerId);
  if (job.intervalId) clearInterval(job.intervalId);

  const msUntil = getNextRunMs(job.etHour, job.etMinute);
  const hoursUntil = (msUntil / 3_600_000).toFixed(1);

  logger.info({
    passName: job.passName,
    etTime: `${String(job.etHour).padStart(2, "0")}:${String(job.etMinute).padStart(2, "0")} ET`,
    hoursUntil,
  }, `AI Lab: scheduled ${job.passName}`);

  job.timerId = setTimeout(() => {
    void job.handler().catch((err) => {
      logger.error({ err, passName: job.passName }, `AI Lab: ${job.passName} failed`);
    });

    job.intervalId = setInterval(() => {
      void job.handler().catch((err) => {
        logger.error({ err, passName: job.passName }, `AI Lab: ${job.passName} failed`);
      });
    }, 24 * 60 * 60 * 1000);
  }, msUntil);
}

export function initAiLabOrchestrator(): void {
  if (orchestratorInitialized) {
    logger.warn("AI Lab Orchestrator: already initialized, skipping");
    return;
  }
  orchestratorInitialized = true;

  logger.info("AI Lab Orchestrator: initializing scheduled passes");
  for (const job of SCHEDULE) {
    scheduleJob(job);
  }
  logger.info(`AI Lab Orchestrator: ${SCHEDULE.length} passes scheduled`);
}

export {
  overnightDigest,
  preMarketPlan,
  postOpenCheck,
  midMorningScan,
  middayRotationCheck,
  powerHourPrep,
  postMarketReflection,
  logAiLabEvent,
  runPipeline,
};
