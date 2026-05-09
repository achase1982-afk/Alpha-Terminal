import { db, aiLabIdeasTable, aiLabWatchlistTable, aiLabEmbeddingsTable, aiLabDeliberationsTable, optionsChainDailyTable, equityDailyTable } from "@workspace/db";
import { eq, inArray, desc, sql, and, count } from "@workspace/db";
import { emitTelemetry, createTelemetryBatch } from "./telemetryStore.js";
import {
  getUniverseAnomalies,
  getTickerSnapshot,
  getRegimeState,
  getScannerAlignment,
  getCompactUniverseSummaries,
  getOptionsChainSummary,
  AI_LAB_CONFIG,
  type TickerSnapshot,
  type RegimeState,
  type OptionsChainSummary,
} from "./aiLabService.js";
import {
  validateAiLabIdea,
  isOnCooldown,
  addToCooldown,
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
  ConversationTurn,
  DeliberationLog,
  UniverseScreenRequest,
  CompactTickerSummary,
} from "./aiLabLlmTypes.js";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

export function getOrchestratorConfig() {
  const cfg = getAiLabStrategistConfig();
  return {
    OVERNIGHT_TOP_N: cfg.overnightTopN,
    PREMARKET_TOP_N: cfg.premarketTopN,
    TRIGGER_MIN_AVG_VOLUME: cfg.triggerMinAvgVolume,
    PRICE_SHOCK_MIN_MOVE_PCT: cfg.priceShockMinMovePct,
    BLOCK_FLOW_MIN_NOTIONAL: cfg.blockFlowMinNotional,
    SCANNER_SCORE_MIN_DELTA: cfg.scannerScoreMinDelta,
    ET_OFFSET_HOURS: -5,
    MAX_DELIBERATION_ROUNDS: cfg.maxDeliberationRounds,
  };
}

export let ORCHESTRATOR_CONFIG = getOrchestratorConfig();

export function refreshOrchestratorConfig() {
  ORCHESTRATOR_CONFIG = getOrchestratorConfig();
}

/** `AnalystRequest` expects a loose JSON bag; build explicitly so we do not rely on object spread + casts. */
function toAnalystTickerSnapshotRecord(
  snapshot: TickerSnapshot,
  extras: { availableExpirations: string[]; optionsChainSummary: OptionsChainSummary },
): Record<string, unknown> {
  return {
    symbol: snapshot.symbol,
    recentPriceSummary: snapshot.recentPriceSummary,
    volumeSummary: snapshot.volumeSummary,
    ivSummary: snapshot.ivSummary,
    flowSummary: snapshot.flowSummary,
    rsSummary: snapshot.rsSummary,
    scannerAlignment: snapshot.scannerAlignment,
    regimeAtCreation: snapshot.regimeAtCreation,
    pulseSnapshot: snapshot.pulseSnapshot,
    liquidityMetrics: snapshot.liquidityMetrics,
    latestClose: snapshot.latestClose,
    availableExpirations: extras.availableExpirations,
    optionsChainSummary: extras.optionsChainSummary,
  };
}

function toRegimeStateRecord(regime: RegimeState): Record<string, unknown> {
  return {
    date: regime.date,
    trendState: regime.trendState,
    volState: regime.volState,
    breadthState: regime.breadthState,
    macroFlags: regime.macroFlags,
    pulseSummary: regime.pulseSummary,
  };
}

/** Legacy `price` on snapshots is not on `TickerSnapshot`; read dynamically without widening the whole object. */
function optionalSnapshotPrice(snapshot: TickerSnapshot): number | null {
  const p = Reflect.get(snapshot, "price");
  return typeof p === "number" && Number.isFinite(p) ? p : null;
}

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
  const logPayload = { type, ...payload };
  if (severity === "ERROR") {
    logger.error(logPayload, message);
  } else if (severity === "WARN") {
    logger.warn(logPayload, message);
  } else {
    logger.info(logPayload, message);
  }
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

async function getAvailableExpirations(symbol: string): Promise<string[]> {
  try {
    const rows = await db
      .selectDistinct({ expiration: optionsChainDailyTable.expiration })
      .from(optionsChainDailyTable)
      .where(eq(optionsChainDailyTable.underlyingSymbol, symbol.toUpperCase()))
      .orderBy(optionsChainDailyTable.expiration);
    return rows.map(r => r.expiration);
  } catch {
    return [];
  }
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
  const availableExpirations = await getAvailableExpirations(symbol);

  const currentPrice = snapshot.latestClose ?? snapshot.recentPriceSummary?.high20d ?? 0;
  const optionsChainSummary = await getOptionsChainSummary(symbol, currentPrice);
  logAiLabEvent("OPTIONS_CHAIN_FETCHED", {
    symbol,
    passName: source,
    available: optionsChainSummary.available,
    pricedCount: optionsChainSummary.pricedContractCount,
    totalCount: optionsChainSummary.totalContractCount,
  }, batch);

  const tickerSnapshotData = toAnalystTickerSnapshotRecord(snapshot, {
    availableExpirations,
    optionsChainSummary,
  });
  const regimeData = toRegimeStateRecord(regime);

  const analystRequest: AnalystRequest = {
    symbol,
    runContext,
    tickerSnapshot: tickerSnapshotData,
    regimeState: regimeData,
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

  const conversationTurns: ConversationTurn[] = [];

  conversationTurns.push({
    round: 1,
    role: "analyst",
    timestamp: new Date().toISOString(),
    content: {
      note: analystResponse.analystNote,
      signalStrength: analystResponse.confidence.signalStrength,
      convictionLevel: analystResponse.confidence.convictionLevel,
      direction: analystResponse.tradeIdeaCore.direction,
      structure: analystResponse.primaryProposal.structure,
    },
  });

  const skepticRequest: SkepticRequest = {
    symbol,
    runContext,
    tickerSnapshot: tickerSnapshotData,
    regimeState: regimeData,
    candidateIdea: analystResponse,
  };

  let skepticResponse: SkepticResponse | null = null;
  try {
    skepticResponse = await skepticClient.critiqueIdea(skepticRequest);
    logAiLabEvent("SKEPTIC_RESPONSE", {
      symbol,
      round: 1,
      critiqueScore: skepticResponse.critiqueScore,
      flags: skepticResponse.flags,
    }, batch);

    conversationTurns.push({
      round: 1,
      role: "skeptic",
      timestamp: new Date().toISOString(),
      content: {
        note: skepticResponse.criticNote,
        critiqueScore: skepticResponse.critiqueScore,
        objections: skepticResponse.skepticCritique.objections,
        suggestedChanges: skepticResponse.skepticCritique.suggestedChanges,
        flags: skepticResponse.flags,
      },
    });
  } catch (err: any) {
    logAiLabEvent("SKEPTIC_PARSE_ERROR", {
      symbol,
      passName: source,
      errorMessage: err.message,
      rawSnippet: String(err.message).slice(0, 200),
    }, batch, "WARN");
  }

  let currentIdea = analystResponse;
  let currentSkepticResponse = skepticResponse;
  let reachedConsensus = false;
  let consensusSummary = "";
  let totalRounds = 1;

  if (currentSkepticResponse && currentSkepticResponse.critiqueScore > 25) {
    for (let round = 2; round <= ORCHESTRATOR_CONFIG.MAX_DELIBERATION_ROUNDS; round++) {
      totalRounds = round;

      logAiLabEvent("DELIBERATION_ROUND", {
        symbol,
        round,
        previousCritiqueScore: currentSkepticResponse!.critiqueScore,
      }, batch);

      let rebuttal;
      try {
        rebuttal = await analystClient.rebutCritique({
          symbol,
          runContext,
          tickerSnapshot: tickerSnapshotData,
          regimeState: regimeData,
          currentIdea,
          skepticCritique: currentSkepticResponse!,
          conversationHistory: conversationTurns,
          round,
        });
      } catch (err: any) {
        logAiLabEvent("ANALYST_REBUTTAL_ERROR", {
          symbol, round, errorMessage: err.message,
        }, batch, "WARN");
        consensusSummary = `Deliberation ended round ${round}: analyst rebuttal failed (${err.message})`;
        break;
      }

      conversationTurns.push({
        round,
        role: "analyst",
        timestamp: new Date().toISOString(),
        content: {
          note: rebuttal.rebuttalNote,
          concessions: rebuttal.concessions,
          changesFromPrevious: rebuttal.changesFromPrevious,
          agreesWithSkeptic: rebuttal.agreesWithSkeptic,
          signalStrength: rebuttal.revisedIdea.confidence.signalStrength,
          convictionLevel: rebuttal.revisedIdea.confidence.convictionLevel,
          direction: rebuttal.revisedIdea.tradeIdeaCore.direction,
          structure: rebuttal.revisedIdea.primaryProposal.structure,
        },
      });

      logAiLabEvent("ANALYST_REBUTTAL", {
        symbol, round,
        agreesWithSkeptic: rebuttal.agreesWithSkeptic,
        changesFromPrevious: rebuttal.changesFromPrevious,
        concessions: rebuttal.concessions,
      }, batch);

      if (rebuttal.agreesWithSkeptic) {
        reachedConsensus = true;
        consensusSummary = `Consensus reached round ${round}: analyst agreed to withdraw. ${rebuttal.rebuttalNote}`;
        currentIdea = rebuttal.revisedIdea;
        logAiLabEvent("CONSENSUS_ANALYST_WITHDREW", { symbol, round }, batch);
        break;
      }

      currentIdea = rebuttal.revisedIdea;

      let reEval;
      try {
        reEval = await skepticClient.reEvaluate({
          symbol,
          runContext,
          tickerSnapshot: tickerSnapshotData,
          regimeState: regimeData,
          revisedIdea: currentIdea,
          analystRebuttal: rebuttal,
          conversationHistory: conversationTurns,
          round,
        });
      } catch (err: any) {
        logAiLabEvent("SKEPTIC_REEVAL_ERROR", {
          symbol, round, errorMessage: err.message,
        }, batch, "WARN");
        consensusSummary = `Deliberation ended round ${round}: skeptic re-eval failed (${err.message})`;
        break;
      }

      conversationTurns.push({
        round,
        role: "skeptic",
        timestamp: new Date().toISOString(),
        content: {
          note: reEval.criticNote,
          critiqueScore: reEval.critiqueScore,
          satisfiedWithChanges: reEval.satisfiedWithChanges,
          remainingConcerns: reEval.remainingConcerns,
          objections: reEval.skepticCritique.objections,
          suggestedChanges: reEval.skepticCritique.suggestedChanges,
          flags: reEval.flags,
        },
      });

      logAiLabEvent("SKEPTIC_REEVAL", {
        symbol, round,
        critiqueScore: reEval.critiqueScore,
        satisfiedWithChanges: reEval.satisfiedWithChanges,
        remainingConcerns: reEval.remainingConcerns,
      }, batch);

      currentSkepticResponse = reEval;

      if (reEval.satisfiedWithChanges) {
        reachedConsensus = true;
        consensusSummary = `Consensus reached round ${round}: skeptic satisfied. Score: ${reEval.critiqueScore}. ${reEval.remainingConcerns}`;
        logAiLabEvent("CONSENSUS_SKEPTIC_SATISFIED", { symbol, round, finalScore: reEval.critiqueScore }, batch);
        break;
      }

      if (reEval.critiqueScore <= 25) {
        reachedConsensus = true;
        consensusSummary = `Consensus reached round ${round}: skeptic score dropped to ${reEval.critiqueScore} (below threshold).`;
        logAiLabEvent("CONSENSUS_LOW_SCORE", { symbol, round, finalScore: reEval.critiqueScore }, batch);
        break;
      }
    }

    if (!reachedConsensus && !consensusSummary) {
      consensusSummary = `Deliberation ended after ${totalRounds} rounds without consensus. Final skeptic score: ${currentSkepticResponse?.critiqueScore ?? "N/A"}.`;
      logAiLabEvent("DELIBERATION_EXHAUSTED", { symbol, totalRounds, finalScore: currentSkepticResponse?.critiqueScore }, batch, "WARN");
    }
  } else {
    reachedConsensus = true;
    consensusSummary = currentSkepticResponse
      ? `No deliberation needed — skeptic score ${currentSkepticResponse.critiqueScore} (low concern).`
      : "No deliberation — skeptic unavailable.";
  }

  const deliberationLog: DeliberationLog = {
    totalRounds,
    reachedConsensus,
    turns: conversationTurns,
    consensusSummary,
  };

  logAiLabEvent("DELIBERATION_COMPLETE", {
    symbol,
    totalRounds,
    reachedConsensus,
    consensusSummary,
    turnsCount: conversationTurns.length,
  }, batch);

  const merged = buildCandidateIdeaFromLlms(
    symbol,
    currentIdea,
    currentSkepticResponse,
    regime,
    analystClient.modelName,
    skepticClient.modelName,
  );

  const marketData: MarketDataSnapshot = {
    avgVolume20d: snapshot.volumeSummary.median20d,
    dataTimestamp: Date.now(),
    availableExpirations,
  };

  const analystWithdrew = conversationTurns.some(t => t.role === "analyst" && t.content.agreesWithSkeptic === true);
  const deliberationStarted = totalRounds > 1;
  let validation;
  if (analystWithdrew) {
    validation = { approved: false, rejectionReason: "ANALYST_WITHDREW_AFTER_DELIBERATION" };
  } else if (deliberationStarted && !reachedConsensus) {
    validation = { approved: false, rejectionReason: "DELIBERATION_NO_CONSENSUS" };
  } else {
    validation = await validateAiLabIdea(merged.candidate, activeIdeas, marketData);
  }

  const finalDecision = buildFinalDecision(
    merged,
    validation.approved,
    validation.rejectionReason,
  );

  const inputSnapshot = {
    price: optionalSnapshotPrice(snapshot),
    scannerAlignment: snapshot.scannerAlignment ?? null,
    volumeSummary: snapshot.volumeSummary,
    regime: `${regime.trendState}|${regime.volState}|${regime.breadthState}`,
  };

  let ideaId: number | undefined;

  if (!validation.approved) {
    addToCooldown(symbol);
    logAiLabEvent("IDEA_REJECTED", {
      symbol,
      rejectionReason: validation.rejectionReason,
      signalStrength: merged.signalStrength,
      source,
      finalDecision: finalDecision.decision,
      deliberationRounds: totalRounds,
      cooldownAdded: true,
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
        conversationLog: deliberationLog,
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
    deliberationRounds: totalRounds,
    reachedConsensus,
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
      conversationLog: deliberationLog,
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
  return runUniverseScreenPass("PREMARKET_PLAN");
}

async function runUniverseScreenPass(passName: PassName): Promise<void> {
  await withLock(passName, async () => {
    const batch = createTelemetryBatch("AI_LAB");
    logAiLabEvent("SCHEDULE_RUN", { passName, phase: "START", mode: "FULL_UNIVERSE" }, batch);

    try {
      const cfg = getAiLabStrategistConfig();
      if (!cfg.enabled) {
        logAiLabEvent("AI_LAB_DISABLED", { passName }, batch);
        return;
      }

      const summaries = await getCompactUniverseSummaries();
      if (summaries.length === 0) {
        logAiLabEvent("SCHEDULE_RUN", { passName, phase: "COMPLETE", note: "No universe data available" }, batch, "WARN");
        return;
      }

      const regime = await getRegimeState();
      const activeIdeas = await db
        .select()
        .from(aiLabIdeasTable)
        .where(inArray(aiLabIdeasTable.status, ["NEW", "ACTIVE"]));

      const { analyst: analystClient } = buildClients();

      const screenRequest: UniverseScreenRequest = {
        runContext: { passName, timestamp: new Date().toISOString() },
        tickers: summaries as CompactTickerSummary[],
        regimeState: toRegimeStateRecord(regime),
        activeIdeasSummary: {
          activeCount: activeIdeas.length,
          symbols: activeIdeas.map(i => i.symbol),
          sectors: activeIdeas.map(i => i.sector).filter(Boolean) as string[],
        },
      };

      logAiLabEvent("UNIVERSE_SCREEN_REQUEST", {
        passName,
        tickerCount: summaries.length,
        provider: cfg.analystModelProvider,
        model: cfg.analystModelName,
      }, batch);

      const screenResult = await analystClient.screenUniverse(screenRequest);

      logAiLabEvent("UNIVERSE_SCREEN_RESPONSE", {
        passName,
        picksCount: screenResult.picks.length,
        picks: screenResult.picks.map(p => `${p.symbol}(${p.direction},${p.conviction})`).join(", "),
        marketCommentary: screenResult.marketCommentary,
        skippedReason: screenResult.skippedReason,
      }, batch);

      if (screenResult.picks.length === 0) {
        logAiLabEvent("SCHEDULE_RUN", {
          passName,
          phase: "COMPLETE",
          mode: "FULL_UNIVERSE",
          note: `No picks — ${screenResult.skippedReason ?? "analyst found no compelling setups"}`,
          marketCommentary: screenResult.marketCommentary,
        }, batch);
        return;
      }

      const results: PipelineResult[] = [];

      for (const pick of screenResult.picks) {
        if (isOnCooldown(pick.symbol)) {
          logAiLabEvent("UNIVERSE_PICK_SKIPPED", {
            symbol: pick.symbol,
            reason: "On rejection cooldown (24h)",
          }, batch, "WARN");
          results.push({ symbol: pick.symbol, approved: false, rejectionReason: "REJECTION_COOLDOWN" });
          continue;
        }

        if (pick.conviction < 60) {
          logAiLabEvent("UNIVERSE_PICK_SKIPPED", {
            symbol: pick.symbol,
            conviction: pick.conviction,
            reason: "Below 60 conviction threshold from universe screen",
          }, batch, "WARN");
          results.push({ symbol: pick.symbol, approved: false, rejectionReason: "LOW_UNIVERSE_CONVICTION" });
          continue;
        }

        const snapshot = await getTickerSnapshot(pick.symbol);
        if (!snapshot) {
          logAiLabEvent("IDEA_VALIDATION", {
            symbol: pick.symbol,
            approved: false,
            rejectionReason: "NO_SNAPSHOT_DATA",
            source: passName,
          }, batch, "WARN");
          results.push({ symbol: pick.symbol, approved: false, rejectionReason: "NO_SNAPSHOT_DATA" });
          continue;
        }

        logAiLabEvent("UNIVERSE_PICK_TO_PIPELINE", {
          symbol: pick.symbol,
          direction: pick.direction,
          conviction: pick.conviction,
          reasoning: pick.reasoning,
        }, batch);

        const result = await runPipeline(pick.symbol, snapshot, regime, batch, passName);
        results.push(result);
      }

      const approved = results.filter(r => r.approved).length;
      const rejected = results.filter(r => !r.approved).length;

      logAiLabEvent("SCHEDULE_RUN", {
        passName,
        phase: "COMPLETE",
        mode: "FULL_UNIVERSE",
        universeTickers: summaries.length,
        screenPicks: screenResult.picks.length,
        pipelineRun: results.length,
        ideasApproved: approved,
        ideasRejected: rejected,
        marketCommentary: screenResult.marketCommentary,
      }, batch);
    } catch (err: any) {
      logAiLabEvent("SCHEDULE_RUN", { passName, phase: "ERROR", error: err.message }, batch, "ERROR");
    }
  });
}

async function postOpenCheck(): Promise<void> {
  return runUniverseScreenPass("POST_OPEN_CHECK");
}

async function midMorningScan(): Promise<void> {
  return runUniverseScreenPass("MID_MORNING_SCAN");
}

async function middayRotationCheck(): Promise<void> {
  return runUniverseScreenPass("MIDDAY_ROTATION");
}

async function powerHourPrep(): Promise<void> {
  return runUniverseScreenPass("POWER_HOUR_PREP");
}

async function postMarketReflection(): Promise<void> {
  return runUniverseScreenPass("POST_MARKET_REFLECTION");
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

function getEtOffsetHours(): number {
  const jan = new Date(new Date().getFullYear(), 0, 1);
  const jul = new Date(new Date().getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const etNow = new Date(nowStr);
  const utcNow = new Date();
  const diffHours = Math.round((etNow.getTime() - utcNow.getTime()) / 3_600_000);
  return diffHours || (stdOffset === 300 ? -5 : -5);
}

function getNextRunMs(etHour: number, etMinute: number): number {
  const now = new Date();
  const target = new Date(now);
  const utcHour = etHour - getEtOffsetHours();
  target.setUTCHours(utcHour, etMinute, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

function wasMissedToday(etHour: number, etMinute: number): boolean {
  const now = new Date();
  const target = new Date(now);
  const utcHour = etHour - getEtOffsetHours();
  target.setUTCHours(utcHour, etMinute, 0, 0);
  const missedMs = now.getTime() - target.getTime();
  return missedMs > 0 && missedMs < 12 * 3_600_000;
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

  const missedJobs: ScheduledJob[] = [];
  for (const job of SCHEDULE) {
    scheduleJob(job);
    if (wasMissedToday(job.etHour, job.etMinute)) {
      missedJobs.push(job);
    }
  }
  logger.info(`AI Lab Orchestrator: ${SCHEDULE.length} passes scheduled`);

  if (missedJobs.length > 0) {
    logger.info({
      missed: missedJobs.map(j => j.passName),
    }, `AI Lab Orchestrator: ${missedJobs.length} passes missed today — catching up`);

    void waitForEquityDataThenCatchUp(missedJobs);
  }
}

async function waitForEquityDataThenCatchUp(missedJobs: ScheduledJob[]): Promise<void> {
  const MAX_WAIT_MS = 180_000;
  const POLL_INTERVAL_MS = 10_000;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const rows = await db
        .select({ cnt: count() })
        .from(equityDailyTable);
      const total = rows[0]?.cnt ?? 0;
      if (total >= 100) {
        logger.info({ equityRows: total, waitedMs: Date.now() - start }, "AI Lab: equity data ready — running catch-up passes");
        break;
      }
      logger.info({ equityRows: total, waitedMs: Date.now() - start }, "AI Lab: waiting for equity data before catch-up...");
    } catch {
      logger.warn("AI Lab: equity data check failed, retrying...");
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  if (Date.now() - start >= MAX_WAIT_MS) {
    logger.warn("AI Lab: equity data wait timed out — running catch-up anyway");
  }

  let delay = 2_000;
  for (const job of missedJobs) {
    setTimeout(() => {
      logger.info({ passName: job.passName }, `AI Lab: running missed pass ${job.passName}`);
      void job.handler().catch((err) => {
        logger.error({ err, passName: job.passName }, `AI Lab: missed ${job.passName} failed`);
      });
    }, delay);
    delay += 15_000;
  }
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
