import { Router, type IRouter } from "express";
import { analyzeTickerV2, type StrategistV2Result } from "../lib/strategistV2.js";
import { getSettings, updateSetting, resetAllSettings, getDefaults, getSettingMeta } from "../lib/strategistSettings.js";
import { getCachedRegime, buildFallbackRegime } from "../lib/regimePostProcessor.js";
import {
  runTradeValidation,
  type ValidationInput,
  type ValidationTicket,
  type ValidationVerdictPayload,
} from "../lib/strategistValidate.js";
import { getStoredIVR } from "../lib/ivNormalize.js";
import { fetchOptionsChain, summarizeOptionsChain } from "../lib/strategistV2.js";
import { getPolygonFlowHighlights } from "../lib/polygonFlowHighlights.js";
import { evaluateCatalyst } from "../lib/catalystEvaluator.js";
import { computeIOScore } from "../lib/ioScoreEngine.js";
import { getNextEarningsDate } from "../lib/earningsService.js";
import { getEquityDailyExtras } from "../lib/equityDailyExtras.js";
import { db, strategistTelemetryTable, scannerTelemetryTable, strategistHistoryTable } from "@workspace/db";
import { desc, eq, sql, lte, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  ensureIvrCoverage,
  getIvrBackfillJob,
  getLatestIvrBackfillJobForSymbol,
  type IvrCoverageResult,
} from "../lib/onDemandIvrBackfill.js";
import { notifyStrategistCompletion } from "../lib/strategistNotifications.js";
import { sendPushToAll } from "../lib/pushService.js";

const router: IRouter = Router();

function ivrCoverageToResult(coverage: Exclude<IvrCoverageResult, { status: "ready" }>): StrategistV2Result {
  const base = {
    ticker: coverage.symbol,
    regime: getCachedRegime() ?? buildFallbackRegime(),
    systemicRiskElevated: false,
  };
  if (coverage.status === "failed_insufficient_history") {
    return {
      ...base,
      status: "failed_insufficient_history",
      blockReason: {
        category: "MISSING_DATA",
        detail: coverage.message,
        suggestedAction: "Try a ticker with at least 60 trading days of price history.",
      },
      ivrBackfill: {
        jobId: coverage.jobId,
        status: "failed_insufficient_history",
        daysLoaded: coverage.ivDays,
        daysRequested: 252,
        message: coverage.message,
      },
    };
  }
  if (coverage.status === "failed") {
    return {
      ...base,
      status: "no_viable_setup",
      blockReason: {
        category: "MISSING_DATA",
        detail: coverage.message,
        suggestedAction: "Retry the Strategist after the IVR service recovers.",
      },
      ivrBackfill: {
        jobId: coverage.jobId,
        status: "failed",
        daysLoaded: coverage.ivDays,
        daysRequested: 252,
        message: coverage.message,
      },
    };
  }
  return {
    ...base,
    status: "ivr_populating",
    blockReason: {
      category: "MISSING_DATA",
      detail: "IVR populating, check back in ~2-3 minutes.",
      suggestedAction: "The Strategist will run automatically when IVR backfill completes.",
    },
    ivrBackfill: {
      jobId: coverage.jobId,
      status: coverage.jobStatus,
      daysLoaded: coverage.daysLoaded,
      daysRequested: coverage.daysRequested,
      message: "IVR populating, check back in ~2-3 minutes.",
    },
  };
}

router.get("/regime", (_req, res) => {
  const regime = getCachedRegime() ?? buildFallbackRegime();
  res.json(regime);
});

router.get("/ivr-backfill/symbol/:symbol", async (req, res) => {
  try {
    const job = await getLatestIvrBackfillJobForSymbol(req.params.symbol);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json({
      id: job.id,
      symbol: job.symbol,
      status: job.status,
      source: job.source,
      daysLoaded: job.daysLoaded,
      daysRequested: job.daysRequested,
      equityRowsWritten: job.equityRowsWritten,
      ivRowsWritten: job.ivRowsWritten,
      ivrRowsWritten: job.ivrRowsWritten,
      errorMsg: job.errorMsg,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    logger.error({ err }, "StrategistV2: latest IVR backfill job fetch failed");
    res.status(500).json({ error: "Failed to fetch IVR backfill job" });
  }
});

router.get("/ivr-backfill/:jobId", async (req, res) => {
  try {
    const job = await getIvrBackfillJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json({
      id: job.id,
      symbol: job.symbol,
      status: job.status,
      source: job.source,
      daysLoaded: job.daysLoaded,
      daysRequested: job.daysRequested,
      equityRowsWritten: job.equityRowsWritten,
      ivRowsWritten: job.ivRowsWritten,
      ivrRowsWritten: job.ivrRowsWritten,
      errorMsg: job.errorMsg,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    logger.error({ err }, "StrategistV2: IVR backfill job fetch failed");
    res.status(500).json({ error: "Failed to fetch IVR backfill job" });
  }
});

// Structured debate transcript turn. In Solo mode the transcript stays empty
// and the UI falls back to the existing token feed; in Debate mode each AI
// turn is one entry whose `text` grows as tokens stream in.
export type TranscriptTurn = {
  id: string;
  round: 1 | 2 | 3 | "synthesis" | "solo";
  role: "A" | "B" | "synthesis" | "system" | "solo";
  phase: "propose" | "critique" | "final" | "synthesis" | "info" | "solo";
  model: string;
  label: string;
  text: string;
  ts: number;
  done: boolean;
};

/** Persisted in `strategist_history.card_json` for analyze jobs (optional debate transcript). */
type StrategistHistoryAnalyzeCardJson = StrategistV2Result & {
  debateTranscript?: TranscriptTurn[];
};

/** Persisted in `strategist_history.card_json` for background trade-validation jobs. */
interface StrategistHistoryValidationCardJson {
  kind: "validation";
  validation: ValidationVerdictPayload;
  ticket: ValidationTicket;
  thesis: string | null;
  rollingShort: boolean;
  debateTranscript: TranscriptTurn[];
}

// In-memory live thinking buffer per jobId (for streaming-style polling).
// Used for BOTH ticker analysis (kind: "analyze") and trade validation
// (kind: "validation"). The frontend poller discriminates on `kind`.
export type ValidationMeta = {
  ticker: string;
  mode: "opening" | "closing";
  ticket: ValidationTicket;
  thesis?: string;
  rollingShort?: boolean;
};

type ThinkingEntry = {
  jobId: string;
  kind: "analyze" | "validation";
  ticker: string;
  status: string;
  tokens: string[];
  transcript: TranscriptTurn[];
  done: boolean;
  result?: StrategistV2Result;
  validationResult?: ValidationVerdictPayload;
  validationMeta?: ValidationMeta;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};
const strategistThinkingBuffer = new Map<string, ThinkingEntry>();
const THINKING_TTL_MS = 10 * 60 * 1000;

/** One in-flight ticker analyze (POST /analyze with jobId) at a time per symbol. */
const analyzeInFlightTickers = new Set<string>();

async function runAnalyzeWithIvrGate(
  ticker: string,
  opts: Parameters<typeof analyzeTickerV2>[1],
): Promise<StrategistV2Result> {
  const coverage = await ensureIvrCoverage(ticker);
  if (coverage.status !== "ready") {
    return ivrCoverageToResult(coverage);
  }
  return analyzeTickerV2(ticker, opts);
}
/**
 * Pick the latest leg expiration for catalyst-window gating. For tickets
 * with no option legs (equity-only orders), default to today + 45 calendar
 * days — matches the equity strategist's standard look-ahead so the catalyst
 * evaluator surfaces upcoming earnings/FOMC etc. inside a sensible horizon.
 */
function computeFarLegExpiration(ticket: ValidationTicket): string {
  const exps = (ticket.legs ?? [])
    .map(l => l.expiration)
    .filter((e): e is string => typeof e === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e))
    .sort();
  if (exps.length > 0) return exps[exps.length - 1];
  const d = new Date();
  d.setDate(d.getDate() + 45);
  return d.toISOString().slice(0, 10);
}

/**
 * Anchor price for summarizeOptionsChain's ATM scan. Prefer the live
 * underlyingPrice the ticket carries; fall back to median strike of the
 * fetched chain (close enough to identify ATM strikes within the ±2%
 * window summarizeOptionsChain uses). Returns 0 when neither is usable
 * — the caller skips the chain block entirely in that case.
 */
function pickAnchorPrice(ticket: ValidationTicket, strikes: number[]): number {
  if (typeof ticket.underlyingPrice === "number" && ticket.underlyingPrice > 0) {
    return ticket.underlyingPrice;
  }
  if (strikes.length === 0) return 0;
  const sorted = [...strikes].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function pruneThinkingBuffer() {
  const now = Date.now();
  for (const [k, v] of strategistThinkingBuffer.entries()) {
    if (v.done && v.finishedAt && now - v.finishedAt > THINKING_TTL_MS) {
      strategistThinkingBuffer.delete(k);
    } else if (!v.done && now - v.startedAt > 5 * THINKING_TTL_MS) {
      // safety: drop stuck entries after 50 minutes
      strategistThinkingBuffer.delete(k);
    }
  }
}

/** Shared shape for `/thinking` polling and `/job/:id/final` reconciliation after tab resume. */
function thinkingShapeFromEntry(entry: ThinkingEntry, since: number): {
  jobId: string;
  kind: "analyze" | "validation";
  ticker: string;
  status: string;
  tokens: string[];
  nextSince: number;
  transcript: TranscriptTurn[];
  done: boolean;
  result: StrategistV2Result | ValidationVerdictPayload | null;
  validationMeta: ValidationMeta | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
} {
  const s = Math.max(0, since);
  const totalTokens = entry.tokens.length;
  const tokens = s < totalTokens ? entry.tokens.slice(s) : [];
  const result = entry.kind === "validation"
    ? (entry.validationResult ?? null)
    : (entry.result ?? null);
  const safeError = entry.error != null ? "Analysis failed. Please retry." : null;
  return {
    jobId: entry.jobId,
    kind: entry.kind ?? "analyze",
    ticker: entry.ticker,
    status: entry.status,
    tokens,
    nextSince: totalTokens,
    transcript: entry.transcript,
    done: entry.done,
    result,
    validationMeta: entry.validationMeta ?? null,
    error: safeError,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt ?? null,
  };
}

async function persistHistory(
  jobId: string,
  ticker: string,
  result: StrategistV2Result,
  debateTranscript?: TranscriptTurn[],
) {
  try {
    // Stash the debate transcript inside cardJson so it travels with the
    // saved trade card and can be re-rendered from history without needing
    // a DB migration. cardJson is jsonb; downstream typings treat unknown
    // fields as optional.
    const cardJson: StrategistHistoryAnalyzeCardJson =
      debateTranscript && debateTranscript.length > 0
        ? { ...result, debateTranscript }
        : result;
    await db
      .insert(strategistHistoryTable)
      .values({ jobId, ticker, cardJson, cleared: false })
      .onConflictDoNothing({ target: strategistHistoryTable.jobId });
  } catch (persistErr) {
    logger.warn({ persistErr, jobId, ticker }, "StrategistV2: failed to persist history (non-fatal)");
  }
}

router.post("/analyze", async (req, res): Promise<void> => {
  try {
    const { ticker, jobId, flowContext } = req.body as { ticker?: string; jobId?: string; flowContext?: string };
    if (!ticker || typeof ticker !== "string") {
      res.status(400).json({ error: "ticker is required" });
      return;
    }
    const upperTicker = ticker.toUpperCase();

    // If jobId provided, run analyze in background with progress streaming
    // and respond immediately with {jobId} so the UI can poll.
    if (jobId && typeof jobId === "string") {
      pruneThinkingBuffer();
      // Idempotency: if a buffer already exists for this jobId, return it.
      const existing = strategistThinkingBuffer.get(jobId);
      if (existing) {
        res.json({ jobId, accepted: true, alreadyRunning: !existing.done });
        return;
      }
      if (analyzeInFlightTickers.has(upperTicker)) {
        res.status(409).json({
          code: "ANALYSIS_ALREADY_IN_PROGRESS",
          ticker: upperTicker,
          message: `Analysis already in progress for ${upperTicker}`,
        });
        return;
      }
      analyzeInFlightTickers.add(upperTicker);
      const entry: ThinkingEntry = {
        jobId,
        kind: "analyze",
        ticker: upperTicker,
        status: "Starting analysis…",
        tokens: [],
        transcript: [],
        done: false,
        startedAt: Date.now(),
      };
      strategistThinkingBuffer.set(jobId, entry);

      // Fire-and-forget background analysis
      void (async () => {
        try {
          const result = await runAnalyzeWithIvrGate(upperTicker, {
            flowContext: typeof flowContext === "string" && flowContext.length > 0 ? flowContext.slice(0, 8000) : undefined,
            onStatus: (s) => {
              entry.status = s;
            },
            onToken: (t) => {
              entry.tokens.push(t);
              // Cap memory: keep last ~6000 tokens (~24KB+)
              if (entry.tokens.length > 6000) entry.tokens.splice(0, entry.tokens.length - 6000);
            },
            onTurnStart: (turn) => {
              entry.transcript.push({
                id: turn.id,
                round: turn.round,
                role: turn.role,
                phase: turn.phase,
                model: turn.model,
                label: turn.label,
                text: "",
                ts: turn.startedAt,
                done: false,
              });
              // Defensive cap on transcript size (3 rounds * 2 + synthesis = 7 max).
              if (entry.transcript.length > 32) entry.transcript.splice(0, entry.transcript.length - 32);
            },
            onTurnDelta: (turnId, delta) => {
              const t = entry.transcript.find(x => x.id === turnId);
              if (t) t.text += delta;
            },
            onTurnDone: (turnId, finalText) => {
              const t = entry.transcript.find(x => x.id === turnId);
              if (t) {
                t.text = finalText;
                t.done = true;
              }
            },
            onTurnDiscarded: (turnId) => {
              const i = entry.transcript.findIndex(x => x.id === turnId);
              if (i >= 0) entry.transcript.splice(i, 1);
            },
          });
          entry.result = result;
          entry.status = "Done";
          entry.done = true;
          entry.finishedAt = Date.now();
          await persistHistory(jobId, upperTicker, result, entry.transcript);
          if (result.status !== "ivr_populating") {
            notifyStrategistCompletion({
              jobId,
              ticker: upperTicker,
              kind: result.status === "recommendation" ? "ready" : "failed",
              message: result.status === "recommendation"
                ? `Strategist ready for ${upperTicker}`
                : `Strategist failed for ${upperTicker}`,
              resultStatus: result.status,
            });
            void sendPushToAll({
              title: result.status === "recommendation"
                ? `Strategist ready — ${upperTicker}`
                : `Strategist — ${upperTicker}`,
              body: result.status === "recommendation"
                ? "Analysis finished. Open the app to view the card."
                : "Analysis finished with no trade. Open the app for details.",
              tag: `strategist-${jobId}`,
              data: { type: "strategist", jobId, ticker: upperTicker, kind: "analyze" as const },
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          entry.error = message;
          entry.status = "Analysis failed";
          entry.done = true;
          entry.finishedAt = Date.now();
          notifyStrategistCompletion({
            jobId,
            ticker: upperTicker,
            kind: "failed",
            message: `Strategist failed for ${upperTicker}`,
            resultStatus: "error",
          });
          void sendPushToAll({
            title: `Strategist failed — ${upperTicker}`,
            body: "Open the app to retry.",
            tag: `strategist-${jobId}`,
            data: { type: "strategist", jobId, ticker: upperTicker, kind: "analyze_failed" as const },
          });
          logger.error({ err, jobId, ticker: upperTicker }, "StrategistV2: background analyze failed");
        } finally {
          analyzeInFlightTickers.delete(upperTicker);
        }
      })();

      res.json({ jobId, accepted: true, alreadyRunning: false });
      return;
    }

    // Legacy synchronous path (no jobId): block and return result
    if (analyzeInFlightTickers.has(upperTicker)) {
      res.status(409).json({
        code: "ANALYSIS_ALREADY_IN_PROGRESS",
        ticker: upperTicker,
        message: `Analysis already in progress for ${upperTicker}`,
      });
      return;
    }
    analyzeInFlightTickers.add(upperTicker);
    try {
      const result = await runAnalyzeWithIvrGate(upperTicker, {
        flowContext: typeof flowContext === "string" && flowContext.length > 0 ? flowContext.slice(0, 8000) : undefined,
      });
      res.json(result);
    } finally {
      analyzeInFlightTickers.delete(upperTicker);
    }
  } catch (err) {
    logger.error({ err }, "StrategistV2: analyze failed");
    res.status(500).json({ error: "Analysis failed" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /validate-trade
// Body: { ticket: ValidationTicket, jobId: string, thesis?: string,
//         rollingShort?: boolean }
// Reuses the strategistThinkingBuffer with kind: "validation" so the
// existing /thinking/:jobId poller works unchanged.
// ──────────────────────────────────────────────────────────────────────
router.post("/validate-trade", (req, res): void => {
  try {
    const { ticket, jobId, thesis, rollingShort } = req.body as {
      ticket?: ValidationTicket;
      jobId?: string;
      thesis?: string;
      rollingShort?: boolean;
    };
    if (!jobId || typeof jobId !== "string") {
      res.status(400).json({ error: "jobId is required" });
      return;
    }
    if (!ticket || typeof ticket !== "object" || !ticket.ticker) {
      res.status(400).json({ error: "ticket with ticker is required" });
      return;
    }
    const upperTicker = String(ticket.ticker).toUpperCase();

    pruneThinkingBuffer();
    const existing = strategistThinkingBuffer.get(jobId);
    if (existing) {
      res.json({ jobId, accepted: true, alreadyRunning: !existing.done });
      return;
    }

    const meta: ValidationMeta = {
      ticker: upperTicker,
      mode: ticket.mode,
      ticket: { ...ticket, ticker: upperTicker },
      thesis: typeof thesis === "string" ? thesis.slice(0, 4000) : undefined,
      rollingShort: rollingShort === true,
    };

    const entry: ThinkingEntry = {
      jobId,
      kind: "validation",
      ticker: upperTicker,
      status: "Starting trade validation…",
      tokens: [],
      transcript: [],
      done: false,
      validationMeta: meta,
      startedAt: Date.now(),
    };
    strategistThinkingBuffer.set(jobId, entry);

    const input: ValidationInput = {
      ticket: meta.ticket,
      thesis: meta.thesis,
      rollingShort: meta.rollingShort,
      // marketContext is filled in inside the async block so the fetch can
      // await getStoredIVR() without blocking the HTTP response.
    };

    void (async () => {
      try {
        // ── Backend data gather (Tier 1+2+3, parallel) ───────────────────
        // Pull every per-ticker scalar the strategist normally sees in one
        // wave so the validators see the same canonical numbers. Each
        // sub-fetch is independently allowed to fail — the data package
        // omits the corresponding section rather than fabricating values.
        //
        // Far-leg expiration: the catalyst evaluator gates on whether a
        // catalyst lands inside the trade window. For multi-leg orders we
        // use the latest leg expiration; for equity-only / no-leg tickets
        // we default to today + 45 calendar days (matches the equity
        // strategist's standard look-ahead).
        const farLegExpISO = computeFarLegExpiration(meta.ticket);

        const settings = await getSettings().catch(() => null);

        const [
          ivrR, chainR, polygonR, catalystR, regimeR, earningsR, extrasR,
        ] = await Promise.allSettled([
          getStoredIVR(upperTicker),
          // fetchOptionsChain needs settings; without it we just skip.
          settings ? fetchOptionsChain(upperTicker, settings) : Promise.resolve(null),
          getPolygonFlowHighlights(upperTicker),
          evaluateCatalyst({ ticker: upperTicker, expirationISO: farLegExpISO }),
          // getCachedRegime() is sync and never throws; wrap so the slot
          // index alignment stays simple.
          Promise.resolve(getCachedRegime() ?? buildFallbackRegime()),
          getNextEarningsDate(upperTicker),
          getEquityDailyExtras(upperTicker),
        ]);

        // Explicit per-slot rejection logging. Some sub-fetches self-log
        // (e.g. polygonFlow), but others (getStoredIVR DB error,
        // getEquityDailyExtras schema error) can throw silently here. Log
        // every rejection BEFORE we degrade to null so an operator can
        // diagnose missing sections from the data package.
        const slotRejections: Array<[string, PromiseSettledResult<unknown>]> = [
          ["ivr", ivrR], ["chain", chainR], ["polygonFlow", polygonR],
          ["catalyst", catalystR], ["regime", regimeR],
          ["nextEarnings", earningsR], ["equityExtras", extrasR],
        ];
        for (const [slot, r] of slotRejections) {
          if (r.status === "rejected") {
            logger.warn(
              { jobId, ticker: upperTicker, slot, reason: r.reason instanceof Error ? r.reason.message : String(r.reason) },
              "TradeValidation: marketContext sub-fetch rejected (degrading to null)",
            );
          }
        }

        // IO score: depends on having a catalyst flag input. Per the
        // scanner pattern, we pass a neutral "validation_probe" flag here
        // — the catalyst signal is already surfaced separately in the
        // CATALYSTS section, so feeding it into IO would double-count.
        const ioScoreP = settings
          ? computeIOScore(upperTicker, { flagValue: 0, reason: "validation_probe" }, settings).catch((err) => {
              logger.warn(
                { jobId, ticker: upperTicker, slot: "ioScore", reason: err instanceof Error ? err.message : String(err) },
                "TradeValidation: marketContext sub-fetch rejected (degrading to null)",
              );
              return null;
            })
          : Promise.resolve(null);

        // Build chain summary if the chain fetch succeeded and we have a
        // price to anchor the ATM scan. Falls back to median-strike when
        // the ticket lacks underlyingPrice.
        let chainSummary = null;
        let chainSource = null;
        if (chainR.status === "fulfilled" && chainR.value && chainR.value.chain.length > 0) {
          chainSource = chainR.value.source;
          const price = pickAnchorPrice(meta.ticket, chainR.value.chain.map(c => c.strike));
          if (price > 0) {
            try {
              chainSummary = summarizeOptionsChain(chainR.value.chain, price);
            } catch (sErr) {
              logger.warn({ sErr, jobId, ticker: upperTicker }, "TradeValidation: summarizeOptionsChain threw (non-fatal)");
            }
          }
        }

        const ivr = ivrR.status === "fulfilled" ? ivrR.value : null;
        const polygonHighlights = polygonR.status === "fulfilled" ? polygonR.value : null;
        const catalyst = catalystR.status === "fulfilled" ? catalystR.value : null;
        const regime = regimeR.status === "fulfilled" ? regimeR.value : null;
        const nextEarnings = earningsR.status === "fulfilled" ? earningsR.value : null;
        const equityExtras = extrasR.status === "fulfilled" ? extrasR.value : null;
        const ioScore = await ioScoreP;

        input.marketContext = {
          ivr: ivr?.ivr ?? null,
          ivrAsOfDate: ivr?.asOfDate ?? null,
          ivrSource: ivr?.source ?? null,
          catalyst,
          nextEarnings,
          ioScore,
          regime,
          polygonHighlights,
          chainSummary,
          chainSource,
          equityExtras,
        };

        logger.info(
          {
            jobId, ticker: upperTicker,
            farLegExpISO,
            present: {
              ivr: ivr != null,
              chainSummary: chainSummary != null,
              chainSource,
              polygonHighlights: polygonHighlights != null,
              catalyst: catalyst != null,
              nextEarnings: nextEarnings?.daysAway ?? null,
              ioScoreAvailable: ioScore?.available ?? null,
              regime: regime != null,
              equityExtras: equityExtras != null,
            },
          },
          "TradeValidation: marketContext assembled",
        );

        const result = await runTradeValidation(input, {
          onStatus: (s) => { entry.status = s; },
          onTurnStart: (turn) => {
            entry.transcript.push({
              id: turn.id, round: turn.round, role: turn.role, phase: turn.phase,
              model: turn.model, label: turn.label, text: "", ts: turn.startedAt, done: false,
            });
            if (entry.transcript.length > 32) entry.transcript.splice(0, entry.transcript.length - 32);
          },
          onTurnDelta: (turnId, delta) => {
            const t = entry.transcript.find(x => x.id === turnId);
            if (t) t.text += delta;
          },
          onTurnDone: (turnId, finalText) => {
            const t = entry.transcript.find(x => x.id === turnId);
            if (t) { t.text = finalText; t.done = true; }
          },
        });
        entry.validationResult = result;
        entry.status = `Verdict: ${result.verdict}`;
        entry.done = true;
        entry.finishedAt = Date.now();

        // Persist to history with a discriminator inside cardJson so the
        // existing history table works without a migration.
        try {
          const cardJson: StrategistHistoryValidationCardJson = {
            kind: "validation",
            validation: result,
            ticket: meta.ticket,
            thesis: meta.thesis ?? null,
            rollingShort: meta.rollingShort ?? false,
            debateTranscript: entry.transcript,
          };
          await db
            .insert(strategistHistoryTable)
            .values({ jobId, ticker: upperTicker, cardJson, cleared: false })
            .onConflictDoNothing({ target: strategistHistoryTable.jobId });
          notifyStrategistCompletion({
            jobId,
            ticker: upperTicker,
            kind: "ready",
            message: `Trade validation ready for ${upperTicker}`,
            resultStatus: result.verdict,
          });
          void sendPushToAll({
            title: `Validation ready — ${upperTicker}`,
            body: `Verdict: ${result.verdict.replace(/_/g, " ")}. Open the app to review.`,
            tag: `strategist-${jobId}`,
            data: { type: "strategist", jobId, ticker: upperTicker, kind: "validation" as const },
          });
        } catch (persistErr) {
          logger.warn({ persistErr, jobId }, "TradeValidation: failed to persist history (non-fatal)");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        entry.error = message;
        entry.status = "Validation failed";
        entry.done = true;
        entry.finishedAt = Date.now();
        notifyStrategistCompletion({
          jobId,
          ticker: upperTicker,
          kind: "failed",
          message: `Trade validation failed for ${upperTicker}`,
          resultStatus: "error",
        });
        void sendPushToAll({
          title: `Validation failed — ${upperTicker}`,
          body: "Open the app to retry.",
          tag: `strategist-${jobId}`,
          data: { type: "strategist", jobId, ticker: upperTicker, kind: "validation_failed" as const },
        });
        logger.error({ err, jobId, ticker: upperTicker }, "TradeValidation: background validate failed");
      }
    })();

    res.json({ jobId, accepted: true, alreadyRunning: false });
  } catch (err) {
    logger.error({ err }, "TradeValidation: validate-trade route failed");
    res.status(500).json({ error: "Validation failed to start" });
  }
});

// Re-fetch final strategist state from DB when the in-memory buffer is gone
// (e.g. tab backgrounded + TTL). Kept in sync with client `strategistPoller` recovery.
router.get("/job/:jobId/final", async (req, res): Promise<void> => {
  const jobId = req.params.jobId;
  if (!jobId) {
    res.status(400).json({ error: "jobId required" });
    return;
  }
  pruneThinkingBuffer();
  const inMem = strategistThinkingBuffer.get(jobId);
  if (inMem) {
    const sinceRaw = req.query.since;
    const since = typeof sinceRaw === "string" ? Math.max(0, parseInt(sinceRaw, 10) || 0) : 0;
    res.json(thinkingShapeFromEntry(inMem, since));
    return;
  }
  try {
    const rows = await db
      .select()
      .from(strategistHistoryTable)
      .where(and(eq(strategistHistoryTable.jobId, jobId), eq(strategistHistoryTable.cleared, false)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    const card = row.cardJson as Record<string, unknown>;
    const isValidation = card["kind"] === "validation";
    const ticker = row.ticker;
    const transcriptRaw = card["debateTranscript"];
    const safeTranscript = Array.isArray(transcriptRaw) ? (transcriptRaw as TranscriptTurn[]) : [];
    res.json({
      jobId,
      kind: isValidation ? "validation" : "analyze",
      ticker,
      status: isValidation ? `Verdict: ${String((card["validation"] as { verdict?: string })?.verdict ?? "done")}` : "Done",
      tokens: [],
      nextSince: 0,
      transcript: safeTranscript,
      done: true,
      result: isValidation
        ? (card["validation"] as ValidationVerdictPayload)
        : (card as unknown as StrategistV2Result),
      validationMeta: isValidation
        ? {
            ticker,
            mode: (card["ticket"] as ValidationTicket).mode,
            ticket: card["ticket"] as ValidationTicket,
            thesis: typeof card["thesis"] === "string" ? card["thesis"] : undefined,
            rollingShort: card["rollingShort"] === true,
          }
        : null,
      error: null,
      startedAt: row.createdAt?.getTime?.() ?? Date.now(),
      finishedAt: row.createdAt?.getTime?.() ?? Date.now(),
      source: "persisted" as const,
    });
  } catch (err) {
    logger.error({ err, jobId }, "StrategistV2: job final fetch failed");
    res.status(500).json({ error: "Failed to load job" });
  }
});

router.get("/thinking/:jobId", (req, res): void => {
  pruneThinkingBuffer();
  const entry = strategistThinkingBuffer.get(req.params.jobId);
  if (!entry) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  const sinceRaw = req.query.since;
  const since = typeof sinceRaw === "string" ? Math.max(0, parseInt(sinceRaw, 10) || 0) : 0;
  res.json(thinkingShapeFromEntry(entry, since));
});

router.get("/history", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(strategistHistoryTable)
      .where(eq(strategistHistoryTable.cleared, false))
      .orderBy(desc(strategistHistoryTable.createdAt))
      .limit(100);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "StrategistV2: history fetch failed");
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.patch("/history/:id/clear", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    await db
      .update(strategistHistoryTable)
      .set({ cleared: true, clearedAt: new Date() })
      .where(eq(strategistHistoryTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "StrategistV2: history clear failed");
    res.status(500).json({ error: "Failed to clear history row" });
  }
});

router.delete("/history/all", async (_req, res) => {
  try {
    const result = await db
      .update(strategistHistoryTable)
      .set({ cleared: true, clearedAt: new Date() })
      .where(eq(strategistHistoryTable.cleared, false));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "StrategistV2: history clear-all failed");
    res.status(500).json({ error: "Failed to clear history" });
  }
});

router.get("/settings", async (_req, res) => {
  try {
    const current = await getSettings();
    const meta = getSettingMeta();
    const defaults = getDefaults();
    res.json({ current, meta, defaults });
  } catch (err) {
    logger.error({ err }, "StrategistV2: settings fetch failed");
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res): Promise<void> => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      res.status(400).json({ error: "key and value required" });
      return;
    }
    await updateSetting(key, Number(value));
    const updated = await getSettings();
    res.json({ success: true, current: updated });
  } catch (err: any) {
    logger.error({ err }, "StrategistV2: setting update failed");
    res.status(400).json({ error: err.message || "Update failed" });
  }
});

router.post("/settings/reset", async (_req, res) => {
  try {
    await resetAllSettings();
    const current = await getSettings();
    res.json({ success: true, current });
  } catch (err) {
    logger.error({ err }, "StrategistV2: settings reset failed");
    res.status(500).json({ error: "Reset failed" });
  }
});

router.get("/telemetry/strategist", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const ticker = req.query.ticker as string | undefined;

    const rows = ticker
      ? await db.select().from(strategistTelemetryTable)
          .where(eq(strategistTelemetryTable.ticker, ticker.toUpperCase()))
          .orderBy(desc(strategistTelemetryTable.timestamp)).limit(limit)
      : await db.select().from(strategistTelemetryTable)
          .orderBy(desc(strategistTelemetryTable.timestamp)).limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry fetch failed");
    res.status(500).json({ error: "Failed to fetch telemetry" });
  }
});

router.get("/telemetry/scanner", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const rows = await db.select().from(scannerTelemetryTable)
      .orderBy(desc(scannerTelemetryTable.timestamp)).limit(limit);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "StrategistV2: scanner telemetry fetch failed");
    res.status(500).json({ error: "Failed to fetch scanner telemetry" });
  }
});

router.delete("/telemetry/cleanup", async (_req, res) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    await db.delete(strategistTelemetryTable).where(lte(strategistTelemetryTable.timestamp, cutoff));
    await db.delete(scannerTelemetryTable).where(lte(scannerTelemetryTable.timestamp, cutoff));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry cleanup failed");
    res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
