import { buildStrategistAnalyzeCompletionPush, notifyStrategistCompletion } from "../strategistNotifications.js";
import { sendPushToAll } from "../pushService.js";
import type { StrategistV2Result } from "../strategistV2.js";
import { findJobById } from "./jobs.js";

export async function fireStrategistJobPush(input: {
  userId: string;
  jobId: string;
  ticker: string;
  kind: "analyze" | "validation" | "failure";
}): Promise<void> {
  const { jobId, ticker, kind } = input;

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
        kind: "analyze_failed" as const,
      },
    });
    return;
  }

  if (kind === "validation") {
    const job = await findJobById(jobId);
    const verdict =
      job?.checkpoint && typeof job.checkpoint === "object"
        ? String((job.checkpoint as { validating?: { validationResult?: { verdict?: string } } }).validating?.validationResult?.verdict ?? "")
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
    return;
  }

  const job = await findJobById(jobId);
  let result: StrategistV2Result | null = null;
  if (job?.checkpoint && typeof job.checkpoint === "object") {
    const analyzing = (job.checkpoint as { analyzing?: { analyzeResult?: StrategistV2Result } }).analyzing;
    result = analyzing?.analyzeResult ?? null;
  }
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
    return;
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
}
