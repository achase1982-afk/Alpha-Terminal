import { ensureIvrCoverage, getIvrBackfillJob } from "../lib/onDemandIvrBackfill.js";
import { IVR_TIMEOUT_MS } from "../lib/strategistV3/config.js";
import { mergeJobProgress, updateJobPhase } from "../lib/strategistV3/jobs.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class IvrUnavailableError extends Error {
  code = "iv_unavailable";
  constructor(ticker: string) {
    super(`IVR unavailable for ${ticker}`);
    this.name = "IvrUnavailableError";
  }
}

export class IvrTimeoutError extends Error {
  code = "iv_timeout";
  constructor(ticker: string) {
    super(`IVR timeout for ${ticker}`);
    this.name = "IvrTimeoutError";
  }
}

export async function ensureIvrReadyForWorker(jobId: string, ticker: string): Promise<void> {
  await updateJobPhase(jobId, "preparing_iv");
  await mergeJobProgress(jobId, { liveStatus: "Preparing IV data…" });

  const deadline = Date.now() + IVR_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const coverage = await ensureIvrCoverage(ticker);
    if (coverage.status === "ready") {
      return;
    }
    if (coverage.status === "failed_insufficient_history") {
      throw new IvrUnavailableError(ticker);
    }
    if (coverage.status === "failed") {
      throw new IvrUnavailableError(ticker);
    }
    if (coverage.status === "populating" && coverage.jobId) {
      const job = await getIvrBackfillJob(coverage.jobId);
      if (job?.status === "failed" || job?.status === "failed_insufficient_history") {
        throw new IvrUnavailableError(ticker);
      }
      if (job?.status === "completed") {
        continue;
      }
      await mergeJobProgress(jobId, {
        liveStatus: `Preparing IV data… (${job?.daysLoaded ?? coverage.daysLoaded}/${coverage.daysRequested} days)`,
      });
    }
    await sleep(2_000);
  }
  throw new IvrTimeoutError(ticker);
}
