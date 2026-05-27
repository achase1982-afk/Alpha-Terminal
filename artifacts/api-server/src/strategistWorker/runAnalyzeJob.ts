import type { StrategistJob } from "@workspace/db";
import { analyzeTickerV2 } from "../lib/strategistV2.js";
import { runInStrategistRunContext } from "../lib/strategistRunContext.js";
import { parseScannerContext } from "../lib/scannerStrategistContext.js";
import { normalizeConvictionDeskProviderBody } from "../lib/convictionDeskRouting.js";
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
import { createAnalyzeProgressCallbacks } from "./progressCallbacks.js";
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

      const analyzeResult = await runInStrategistRunContext(
        { scannerContext: scannerContext ?? null, clientTimeZone },
        () => analyzeTickerV2(job.ticker, callbacks),
      );

      if (await isJobCancelled(job.id)) return;

      await writeJobCheckpoint(job.id, "analyzing", { analyzeResult }, "analyzing");
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
