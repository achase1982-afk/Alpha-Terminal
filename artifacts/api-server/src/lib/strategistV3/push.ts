import { buildStrategistAnalyzeCompletionPush, notifyStrategistCompletion } from "../strategistNotifications.js";
import { sendPushToAll } from "../pushService.js";
import type { StrategistV2Result } from "../strategistV2.js";
import type { StrategistJob } from "@workspace/db";
import { claimStrategistPushSend, findJobById } from "./jobs.js";
import { logger } from "../logger.js";

function readAnalyzeResult(job: { checkpoint: unknown }): StrategistV2Result | null {
  if (!job.checkpoint || typeof job.checkpoint !== "object") return null;
  const cp = job.checkpoint as {
    validating?: { analyzeResult?: StrategistV2Result };
    analyzing?: { analyzeResult?: StrategistV2Result };
  };
  return cp.validating?.analyzeResult ?? cp.analyzing?.analyzeResult ?? null;
}

function progressPushSentAt(job: { progress: unknown }): string | null {
  const p = job.progress;
  if (!p || typeof p !== "object") return null;
  const raw = (p as { pushSentAt?: unknown }).pushSentAt;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export async function fireStrategistJobPush(input: {
  userId: string;
  jobId: string;
  ticker: string;
  kind: "analyze" | "validation" | "failure";
}): Promise<boolean> {
  const { jobId, ticker, kind } = input;
  const allowedStatuses: StrategistJob["status"][] =
    kind === "failure" ? ["failed"] : ["completed"];

  const preview = await findJobById(jobId);
  if (!preview || !allowedStatuses.includes(preview.status)) {
    logger.info({ jobId, ticker, kind, status: preview?.status }, "StrategistV3: push skipped — job not terminal");
    return false;
  }
  if (preview.phase != null && preview.phase !== "") {
    logger.warn({ jobId, ticker, phase: preview.phase }, "StrategistV3: push skipped — pipeline phase still active");
    return false;
  }
  if (progressPushSentAt(preview)) {
    logger.info({ jobId, ticker, kind }, "StrategistV3: push skipped — already sent");
    return false;
  }
  if (kind === "analyze") {
    const result = readAnalyzeResult(preview);
    if (result?.status === "ivr_populating") {
      logger.warn({ jobId, ticker }, "StrategistV3: push skipped — IVR still populating");
      return false;
    }
  }

  const job = await claimStrategistPushSend(jobId, allowedStatuses);
  if (!job) {
    logger.info({ jobId, ticker, kind }, "StrategistV3: push skipped — duplicate claim");
    return false;
  }

  if (kind === "failure") {
    notifyStrategistCompletion({
      jobId,
      ticker,
      kind: "failed",
      message: `Strategist failed for ${ticker}`,
      resultStatus: "error",
    });
    await sendPushToAll({
      title: `Strategist failed — ${ticker}`,
      body: "Open the app to retry.",
      tag: `strategist-${jobId}`,
      data: {
        type: "strategist",
        jobId,
        ticker,
        kind: "failure" as const,
      },
    });
    return true;
  }

  if (kind === "validation") {
    const verdict =
      job.checkpoint && typeof job.checkpoint === "object"
        ? String(
            (job.checkpoint as { validating?: { validationResult?: { verdict?: string } } }).validating
              ?.validationResult?.verdict ?? "",
          )
        : "";
    notifyStrategistCompletion({
      jobId,
      ticker,
      kind: "ready",
      message: `Trade validation ready for ${ticker}`,
      resultStatus: verdict || undefined,
    });
    await sendPushToAll({
      title: `Validation ready — ${ticker}`,
      body: verdict ? `Verdict: ${verdict.replace(/_/g, " ")}. Open the app to review.` : "Open the app to review.",
      tag: `strategist-${jobId}`,
      data: { type: "strategist", jobId, ticker, kind: "validation" as const },
    });
    return true;
  }

  const result = readAnalyzeResult(job);
  if (result) {
    const completionPush = buildStrategistAnalyzeCompletionPush(result, ticker);
    notifyStrategistCompletion({
      jobId,
      ticker,
      kind: completionPush.notifyKind,
      message: completionPush.notifyMessage,
      resultStatus: result.status,
    });
    await sendPushToAll({
      title: completionPush.pushTitle,
      body: completionPush.pushBody,
      tag: `strategist-${jobId}`,
      data: { type: "strategist", jobId, ticker, kind: "analyze" as const },
    });
    return true;
  }

  notifyStrategistCompletion({
    jobId,
    ticker,
    kind: "ready",
    message: `Strategist ready for ${ticker}`,
    resultStatus: "done",
  });
  await sendPushToAll({
    title: `Strategist ready — ${ticker}`,
    body: "Open the app to view the card.",
    tag: `strategist-${jobId}`,
    data: { type: "strategist", jobId, ticker, kind: "analyze" as const },
  });
  return true;
}
