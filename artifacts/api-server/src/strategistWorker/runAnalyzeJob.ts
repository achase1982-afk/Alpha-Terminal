import type { StrategistJob } from "@workspace/db";
import {
  analyzeTickerV2,
  analyzeTickerV2FinalizeAfterDebate,
  runDebateForWorker,
  type WorkerPreparedPayload,
} from "../lib/strategistV2.js";
import { getStrategistRunContext, runInStrategistRunContext } from "../lib/strategistRunContext.js";
import { parseScannerContext } from "../lib/scannerStrategistContext.js";
import { normalizeConvictionDeskProviderBody } from "../lib/convictionDeskRouting.js";
import { getSettings } from "../lib/strategistSettings.js";
import { EXPECTED_TURNS } from "../lib/strategistDebate.js";
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
import { ensureIvrReadyForWorker } from "./ensureIvr.js";
import { createAnalyzeProgressCallbacks, applyDebateTurnProgress } from "./progressCallbacks.js";
import { logger } from "../lib/logger.js";

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("timeout") ||
    msg.includes("econnreset")
  );
}

type AnalyzingCheckpoint = {
  prepared?: WorkerPreparedPayload;
  analyzeResult?: unknown;
  telemetryCapture?: Record<string, unknown>;
};

type DebatingCheckpoint = {
  debateResult?: { response: unknown; trace: unknown; rawText: string };
  resumeTurns?: Record<string, string>;
};

type ValidatingCheckpoint = {
  analyzeResult?: unknown;
  telemetryCapture?: Record<string, unknown>;
};

function readAnalyzing(checkpoint: Record<string, unknown>): AnalyzingCheckpoint {
  return (checkpoint["analyzing"] as AnalyzingCheckpoint | undefined) ?? {};
}

function readDebating(checkpoint: Record<string, unknown>): DebatingCheckpoint {
  return (checkpoint["debating"] as DebatingCheckpoint | undefined) ?? {};
}

function readValidating(checkpoint: Record<string, unknown>): ValidatingCheckpoint {
  return (checkpoint["validating"] as ValidatingCheckpoint | undefined) ?? {};
}

export async function runAnalyzeJob(job: StrategistJob): Promise<void> {
  try {
    let current = await findJobById(job.id);
    if (!current || current.status !== "running") return;

    let checkpoint = (current.checkpoint ?? {}) as Record<string, unknown>;
    const params = current.params as Record<string, unknown>;

    if (!checkpoint["preparing_iv"]) {
      if (await isJobCancelled(job.id)) return;
      await ensureIvrReadyForWorker(job.id, job.ticker);
      await writeJobCheckpoint(job.id, "preparing_iv", { ivrReady: true }, "preparing_iv");
    }

    current = (await findJobById(job.id)) ?? current;
    checkpoint = (current.checkpoint ?? {}) as Record<string, unknown>;

    const settings = await getSettings();
    const isDebateMode = settings.strategistMode === 2;
    const analyzingSlice = readAnalyzing(checkpoint);

    if (!checkpoint["analyzing"]) {
      if (await isJobCancelled(job.id)) return;
      await updateJobPhase(job.id, "analyzing");
      await mergeJobProgress(job.id, { liveStatus: "Starting analysis…" });

      const scannerContext = parseScannerContext(params["scannerContext"]);
      const clientTimeZone = typeof params["clientTimeZone"] === "string" ? params["clientTimeZone"] : null;
      const flowContext =
        typeof params["flowContext"] === "string" && params["flowContext"].length > 0
          ? params["flowContext"].slice(0, 8000)
          : undefined;
      const convictionDeskProvider = normalizeConvictionDeskProviderBody(params["convictionDeskProvider"]);

      const { callbacks } = createAnalyzeProgressCallbacks(job.id);
      callbacks.flowContext = flowContext;
      callbacks.convictionDeskProvider = convictionDeskProvider;
      callbacks.workerControl = {
        returnPreparedBeforeDebate: isDebateMode,
        onPipelinePhase: (phase) => {
          void updateJobPhase(job.id, phase);
        },
        onDebateProgress: (turn, expectedTurns) => {
          applyDebateTurnProgress(job.id, turn, expectedTurns);
        },
        onDebateTurnCheckpoint: async (turnKey, text, turnIndex, totalTurns) => {
          const fresh = await findJobById(job.id);
          if (!fresh) return;
          const cp = (fresh.checkpoint ?? {}) as Record<string, unknown>;
          const debating = readDebating(cp);
          const resumeTurns = { ...(debating.resumeTurns ?? {}), [turnKey]: text };
          await writeJobCheckpoint(
            job.id,
            "debating",
            { ...debating, resumeTurns, lastTurnIndex: turnIndex },
            "debating",
          );
          await mergeJobProgress(job.id, { debateTurn: turnIndex, expectedTurns: totalTurns });
        },
      };

      const analyzeResult = await runInStrategistRunContext(
        {
          scannerContext: scannerContext ?? null,
          clientTimeZone,
          userId: job.userId,
          deferTelemetryUntilPersist: true,
        },
        () => analyzeTickerV2(job.ticker, callbacks),
      );

      if (await isJobCancelled(job.id)) return;

      if (isDebateMode && analyzeResult.workerPrepared) {
        await writeJobCheckpoint(job.id, "analyzing", { prepared: analyzeResult.workerPrepared }, "analyzing");
      } else {
        const telemetryCapture = getStrategistRunContext()?.pendingTelemetryCapture ?? undefined;
        await writeJobCheckpoint(
          job.id,
          "analyzing",
          { analyzeResult, telemetryCapture },
          "analyzing",
        );
      }
    }

    current = (await findJobById(job.id)) ?? current;
    checkpoint = (current.checkpoint ?? {}) as Record<string, unknown>;
    const prepared = readAnalyzing(checkpoint).prepared;

    if (isDebateMode && prepared && !readDebating(checkpoint).debateResult) {
      if (await isJobCancelled(job.id)) return;
      await updateJobPhase(job.id, "debating");
      await mergeJobProgress(job.id, {
        liveStatus: "Starting strategist debate…",
        debateTurn: readDebating(checkpoint).resumeTurns
          ? Object.keys(readDebating(checkpoint).resumeTurns!).length
          : 0,
        expectedTurns: EXPECTED_TURNS,
      });

      const debatingSlice = readDebating(checkpoint);
      const { callbacks } = createAnalyzeProgressCallbacks(job.id);
      callbacks.flowContext =
        typeof params["flowContext"] === "string" && params["flowContext"].length > 0
          ? params["flowContext"].slice(0, 8000)
          : undefined;
      callbacks.convictionDeskProvider = normalizeConvictionDeskProviderBody(params["convictionDeskProvider"]);
      callbacks.workerControl = {
        debateResumeTurns: debatingSlice.resumeTurns,
        onPipelinePhase: (phase) => {
          void updateJobPhase(job.id, phase);
        },
        onDebateProgress: (turn, expectedTurns) => {
          applyDebateTurnProgress(job.id, turn, expectedTurns);
        },
        onDebateTurnCheckpoint: async (turnKey, text, turnIndex, totalTurns) => {
          const fresh = await findJobById(job.id);
          if (!fresh) return;
          const cp = (fresh.checkpoint ?? {}) as Record<string, unknown>;
          const debating = readDebating(cp);
          const resumeTurns = { ...(debating.resumeTurns ?? {}), [turnKey]: text };
          await writeJobCheckpoint(
            job.id,
            "debating",
            { ...debating, resumeTurns, lastTurnIndex: turnIndex },
            "debating",
          );
          await mergeJobProgress(job.id, { debateTurn: turnIndex, expectedTurns: totalTurns });
        },
      };

      const debateResult = await runInStrategistRunContext(
        {
          userId: job.userId,
          clientTimeZone: typeof params["clientTimeZone"] === "string" ? params["clientTimeZone"] : null,
          deferTelemetryUntilPersist: true,
        },
        () => runDebateForWorker(prepared, callbacks),
      );

      if (await isJobCancelled(job.id)) return;

      const freshCp = (await findJobById(job.id))?.checkpoint as Record<string, unknown> | undefined;
      const debating = readDebating(freshCp ?? {});
      await writeJobCheckpoint(
        job.id,
        "debating",
        { ...debating, debateResult },
        "debating",
      );
    }

    current = (await findJobById(job.id)) ?? current;
    checkpoint = (current.checkpoint ?? {}) as Record<string, unknown>;

    if (isDebateMode && prepared && !readValidating(checkpoint).analyzeResult) {
      if (await isJobCancelled(job.id)) return;
      await updateJobPhase(job.id, "validating");

      const debateResult = readDebating(checkpoint).debateResult;
      if (!debateResult) {
        throw new Error("Missing debate result for validating phase");
      }

      const { callbacks } = createAnalyzeProgressCallbacks(job.id);
      callbacks.workerControl = {
        onPipelinePhase: (phase) => {
          void updateJobPhase(job.id, phase);
        },
      };

      const finalizeResult = await runInStrategistRunContext(
        {
          userId: job.userId,
          clientTimeZone: typeof params["clientTimeZone"] === "string" ? params["clientTimeZone"] : null,
          deferTelemetryUntilPersist: true,
        },
        () =>
          analyzeTickerV2FinalizeAfterDebate(
            job.ticker,
            prepared,
            debateResult as Parameters<typeof analyzeTickerV2FinalizeAfterDebate>[2],
            callbacks,
          ),
      );

      if (await isJobCancelled(job.id)) return;

      const telemetryCapture = getStrategistRunContext()?.pendingTelemetryCapture ?? undefined;
      await writeJobCheckpoint(
        job.id,
        "validating",
        { analyzeResult: finalizeResult, telemetryCapture },
        "validating",
      );
    }

    if (await isJobCancelled(job.id)) return;
    await updateJobPhase(job.id, "persisting");
    const fresh = await findJobById(job.id);
    if (!fresh || fresh.status !== "running") return;
    await persistAndComplete(fresh);
  } catch (err) {
    if (err instanceof TerminalRaceError) {
      logger.info({ jobId: job.id }, "StrategistWorker: terminal race (cancelled concurrently)");
      return;
    }
    if (await isJobCancelled(job.id)) return;
    if (isTransientError(err) && job.attempt < WORKER_MAX_ATTEMPTS) {
      await releaseJobForRetry(job.id);
      return;
    }
    const fresh = await findJobById(job.id);
    if (fresh && fresh.status === "running") {
      await markJobFailed(fresh, err);
    }
  }
}
