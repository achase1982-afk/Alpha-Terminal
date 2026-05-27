import type { StrategistJob } from "@workspace/db";
import { getSettings } from "../lib/strategistSettings.js";
import { getStoredIVR } from "../lib/ivNormalize.js";
import { fetchOptionsChain, summarizeOptionsChain } from "../lib/strategistV2.js";
import { getPolygonFlowHighlights } from "../lib/polygonFlowHighlights.js";
import { evaluateCatalyst } from "../lib/catalystEvaluator.js";
import { computeIOScore } from "../lib/ioScoreEngine.js";
import { getNextEarningsDate } from "../lib/earningsService.js";
import { getEquityDailyExtras } from "../lib/equityDailyExtras.js";
import { getCachedRegime, buildFallbackRegime } from "../lib/regimePostProcessor.js";
import {
  runTradeValidation,
  type ValidationInput,
  type ValidationTicket,
} from "../lib/strategistValidate.js";
import {
  findJobById,
  isJobCancelled,
  mergeJobProgress,
  releaseJobForRetry,
  updateJobPhase,
  writeJobCheckpoint,
} from "../lib/strategistV3/jobs.js";
import { markJobFailed, persistAndComplete, TerminalRaceError } from "../lib/strategistV3/terminal.js";
import { WORKER_MAX_ATTEMPTS } from "../lib/strategistV3/config.js";
import { createAnalyzeProgressCallbacks } from "./progressCallbacks.js";
import { logger } from "../lib/logger.js";
import type { ValidationMeta } from "../lib/strategistV3/types.js";

function computeFarLegExpiration(ticket: ValidationTicket): string {
  const exps = (ticket.legs ?? [])
    .map((l) => l.expiration)
    .filter((e): e is string => typeof e === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e))
    .sort();
  if (exps.length > 0) return exps[exps.length - 1];
  const d = new Date();
  d.setDate(d.getDate() + 45);
  return d.toISOString().slice(0, 10);
}

function pickAnchorPrice(ticket: ValidationTicket, strikes: number[]): number {
  if (typeof ticket.underlyingPrice === "number" && ticket.underlyingPrice > 0) {
    return ticket.underlyingPrice;
  }
  if (strikes.length === 0) return 0;
  const sorted = [...strikes].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("429") || msg.includes("503") || msg.includes("timeout");
}

export async function runValidateJob(job: StrategistJob): Promise<void> {
  try {
    let current = job;
    const checkpoint = (current.checkpoint ?? {}) as Record<string, unknown>;
    const params = current.params as {
      ticket?: ValidationTicket;
      thesis?: string;
      rollingShort?: boolean;
    };

    const ticket = params.ticket;
    if (!ticket?.ticker) {
      throw new Error("Missing validation ticket");
    }

    const meta: ValidationMeta = {
      ticker: job.ticker,
      mode: ticket.mode,
      ticket: { ...ticket, ticker: job.ticker },
      thesis: typeof params.thesis === "string" ? params.thesis.slice(0, 4000) : undefined,
      rollingShort: params.rollingShort === true,
    };

    await mergeJobProgress(job.id, {
      liveStatus: "Starting trade validation…",
      validationMeta: meta,
      kind: "validation",
    });

    if (!checkpoint["validating"]) {
      if (await isJobCancelled(job.id)) return;
      await updateJobPhase(job.id, "validating");

      const farLegExpISO = computeFarLegExpiration(meta.ticket);
      const settings = await getSettings().catch(() => null);

      const [ivrR, chainR, polygonR, catalystR, regimeR, earningsR, extrasR] = await Promise.allSettled([
        getStoredIVR(job.ticker),
        settings ? fetchOptionsChain(job.ticker, settings) : Promise.resolve(null),
        getPolygonFlowHighlights(job.ticker),
        evaluateCatalyst({ ticker: job.ticker, expirationISO: farLegExpISO }),
        Promise.resolve(getCachedRegime() ?? buildFallbackRegime()),
        getNextEarningsDate(job.ticker),
        getEquityDailyExtras(job.ticker),
      ]);

      const ivr = ivrR.status === "fulfilled" ? ivrR.value : null;
      const polygonHighlights = polygonR.status === "fulfilled" ? polygonR.value : null;
      const catalyst = catalystR.status === "fulfilled" ? catalystR.value : null;
      const regime = regimeR.status === "fulfilled" ? regimeR.value : null;
      const nextEarnings = earningsR.status === "fulfilled" ? earningsR.value : null;
      const equityExtras = extrasR.status === "fulfilled" ? extrasR.value : null;

      let chainSummary = null;
      let chainSource = null;
      if (chainR.status === "fulfilled" && chainR.value && chainR.value.chain.length > 0) {
        chainSource = chainR.value.source;
        const price = pickAnchorPrice(meta.ticket, chainR.value.chain.map((c) => c.strike));
        if (price > 0 && settings) {
          chainSummary = await summarizeOptionsChain(chainR.value.chain, price, {
            ticker: job.ticker,
            settings,
            earningsDate: nextEarnings?.earningsDate ?? null,
          });
        }
      }

      const ioScore =
        settings != null
          ? await computeIOScore(job.ticker, { flagValue: 0, reason: "validation_probe" }, settings).catch(
              () => null,
            )
          : null;

      const input: ValidationInput = {
        ticket: meta.ticket,
        thesis: meta.thesis,
        rollingShort: meta.rollingShort,
        marketContext: {
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
        },
      };

      const { callbacks } = createAnalyzeProgressCallbacks(job.id);
      const validationResult = await runTradeValidation(input, {
        onStatus: (s) => {
          void mergeJobProgress(job.id, { liveStatus: s, validationMeta: meta });
        },
        onTurnStart: (turn) => {
          callbacks.onTurnStart?.({
            id: turn.id,
            round: turn.round as Parameters<NonNullable<typeof callbacks.onTurnStart>>[0]["round"],
            role: turn.role as Parameters<NonNullable<typeof callbacks.onTurnStart>>[0]["role"],
            phase: turn.phase as Parameters<NonNullable<typeof callbacks.onTurnStart>>[0]["phase"],
            model: turn.model,
            label: turn.label,
            startedAt: turn.startedAt,
          });
        },
        onTurnDelta: (turnId, delta) => callbacks.onTurnDelta?.(turnId, delta),
        onTurnDone: (turnId, finalText) => callbacks.onTurnDone?.(turnId, finalText),
      });

      if (await isJobCancelled(job.id)) return;
      await writeJobCheckpoint(job.id, "validating", { validationResult }, "validating");
    }

    if (await isJobCancelled(job.id)) return;
    await updateJobPhase(job.id, "persisting");
    current = (await findJobById(job.id)) ?? current;
    if (current.status !== "running") return;
    await persistAndComplete(current);
  } catch (err) {
    if (err instanceof TerminalRaceError) return;
    if (await isJobCancelled(job.id)) return;
    if (isTransientError(err) && job.attempt < WORKER_MAX_ATTEMPTS) {
      await releaseJobForRetry(job.id);
      return;
    }
    const fresh = await findJobById(job.id);
    if (fresh && fresh.status === "running") {
      await markJobFailed(fresh, err);
    }
    logger.error({ err, jobId: job.id }, "StrategistWorker: validate job failed");
  }
}
